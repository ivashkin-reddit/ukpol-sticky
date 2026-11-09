import { addSeconds } from "date-fns";
import { getSchedule } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { findNextRefresh, isDueAtOnce, isRetryToCome } from "./domain/refreshRules.js";
import type { NextRefresh, ThreadRefreshState } from "./domain/refreshRules.js";
import { getRotationTime, refreshOrder } from "./domain/rotationRules.js";
import { forgetRemovedThreadConfigs, forgetThreadConfigs } from "./forgetThreadConfigs.js";
import type { ForgetPorts } from "./forgetThreadConfigs.js";
import type { PendingRefresh, RefreshJobs, RefreshStatus, RefreshStatusStore, RotationPorts } from "./ports.js";
import { alertingOnRefreshFailure } from "./refreshFailures.js";
import type { RefreshFailureAlertPorts } from "./refreshFailures.js";

// A refresh requested now, as after a config page save, runs a second later.
const REQUESTED_REFRESH_DELAY_SECONDS = 1;

export type SchedulePorts = ForgetPorts & Pick<RotationPorts, "posts">;

export type RequestPorts = RefreshFailureAlertPorts & SchedulePorts;

/** The enabled thread config named `configName`, if one is in force. */
export function findConfigInForce(configs: readonly ThreadConfig[], configName: string): ThreadConfig | undefined {
    return refreshOrder(configs).find((config): boolean => config.name === configName);
}

/** Thread configs by name, for a log line: "thread config a" or "thread configs a, b". */
export function describeThreadConfigs(configNames: readonly string[]): string {
    return `${configNames.length === 1 ? "thread config" : "thread configs"} ${configNames.join(", ")}`;
}

/** What findNextRefresh reads of `config`; its live post is read from Reddit only for its rotation time. */
async function readRefreshState(
    config: ThreadConfig,
    failed: boolean,
    ports: SchedulePorts,
): Promise<ThreadRefreshState> {
    const postId = await ports.livePosts.get(config.name);
    const schedule = getSchedule(config);
    return {
        applied: await ports.appliedThreadConfigs.matches(config),
        failed,
        hasLivePost: postId !== undefined,
        hasUnfinishedHandover: Object.hasOwn(await ports.livePosts.handovers(), config.name),
        rotationTime:
            postId === undefined || schedule === undefined
                ? undefined
                : getRotationTime((await ports.posts.get(postId)).createdAt, schedule),
    };
}

/** Puts `next` in place as the thread config's one pending refresh, records it and logs it; none when undefined. */
async function applyNextRefresh(
    configName: string,
    next: NextRefresh | undefined,
    ports: SchedulePorts,
): Promise<void> {
    if (next === undefined) {
        await ports.refreshJobs.cancelFor(configName);
        await ports.refreshStatus.recordNextRefresh(configName, undefined);
        console.log(`Thread config ${configName} has no schedule, so only its comment cap rotates it.`);
        return;
    }

    await ports.refreshJobs.replaceFor(configName, next.at);
    await ports.refreshStatus.recordNextRefresh(configName, next.at);
    console.log(`Next refresh of thread config ${configName} scheduled for ${next.at.toISOString()}, ${next.reason}.`);
}

/** Schedules the thread config's next refresh by findNextRefresh, or forgets it if it is no longer in force. */
async function scheduleThread(configName: string, failed: boolean, ports: SchedulePorts): Promise<void> {
    // Read first, so thread configs that cannot be read fail before any pending refresh is replaced.
    const config = findConfigInForce(await ports.threadConfigs(), configName);
    if (config === undefined) {
        await forgetThreadConfigs([configName], ports);
        return;
    }

    await applyNextRefresh(
        configName,
        findNextRefresh(await readRefreshState(config, failed, ports), new Date()),
        ports,
    );
}

/**
 * Schedules the thread config's next refresh, as after a refresh of it succeeded or at the upgrade; see
 * findNextRefresh. A thread config no longer in force is forgotten instead.
 */
export async function scheduleNextRefresh(configName: string, ports: SchedulePorts): Promise<void> {
    await scheduleThread(configName, false, ports);
}

/**
 * After the thread config's refresh failed, makes sure a refresh retries it within the retry delay, unless a refresh of
 * it still to come runs before then. While Reddit is down every comment on a full thread fails the same way, and
 * rescheduling for each would churn the scheduler into its limit of 60 new jobs a minute. A refresh whose time has come
 * does not count: the failed refresh's own job is still listed while it runs.
 */
export async function scheduleRetry(configName: string, ports: SchedulePorts): Promise<void> {
    const now = new Date();
    const pending = await ports.refreshJobs.pending();
    const retryPending = pending.some(
        (refresh: PendingRefresh): boolean => refresh.configName === configName && isRetryToCome(refresh.runAt, now),
    );
    if (!retryPending) {
        await scheduleThread(configName, true, ports);
    }
}

/** Requests a refresh of the thread config a second from now, replacing its pending ones, and records it. */
export async function requestThreadRefresh(configName: string, ports: SchedulePorts): Promise<void> {
    const refreshAt = addSeconds(new Date(), REQUESTED_REFRESH_DELAY_SECONDS);
    await ports.refreshJobs.replaceFor(configName, refreshAt);
    await ports.refreshStatus.recordNextRefresh(configName, refreshAt);
}

/** Requests a refresh of the thread config soon, unless one of it already pending is due at once. */
async function requestSoon(
    configName: string,
    pending: readonly PendingRefresh[],
    ports: SchedulePorts,
): Promise<void> {
    const now = new Date();
    const dueAtOnce = pending.some(
        (refresh: PendingRefresh): boolean => refresh.configName === configName && isDueAtOnce(refresh.runAt, now),
    );
    if (!dueAtOnce) {
        await requestThreadRefresh(configName, ports);
    }
}

/**
 * Requests a refresh of every thread config in force, due in a second, and forgets the thread configs no longer in
 * force; `why` ends the log line. A thread config whose pending refresh is due at once keeps it, so repeated saves do
 * not spend the scheduler's limit of 60 new jobs a minute. A failure alerts moderators.
 */
export async function requestEveryThreadRefresh(ports: RequestPorts, why: string): Promise<void> {
    await alertingOnRefreshFailure(ports, async (): Promise<void> => {
        const configNames = refreshOrder(await ports.threadConfigs()).map((config): string => config.name);
        const pending = await ports.refreshJobs.pending();
        await Promise.all(
            configNames.map(async (configName: string): Promise<void> => {
                await requestSoon(configName, pending, ports);
            }),
        );
        await forgetRemovedThreadConfigs(ports);
        console.log(
            configNames.length === 0
                ? "No thread configs are in force, so no refresh is requested."
                : `Requested a refresh of ${describeThreadConfigs(configNames)}: ${why}.`,
        );
    });
}

/** Schedules every thread config's next refresh, then cancels refreshes from before the upgrade, as at the upgrade. */
export async function scheduleEveryThreadRefresh(ports: SchedulePorts): Promise<void> {
    const configs = refreshOrder(await ports.threadConfigs());
    await Promise.all(
        configs.map(async (config): Promise<void> => {
            await scheduleNextRefresh(config.name, ports);
        }),
    );
    await ports.refreshJobs.cancelUnassigned();
}

/** Starts the hourly refresh check, replacing any earlier one. */
export async function startRefreshCheck(refreshJobs: RefreshJobs): Promise<void> {
    await refreshJobs.startHourlyCheck();
}

/**
 * Starts the hourly refresh check again if it has gone. Every refresh calls this, and the check requests a refresh
 * when one is missing, so each keeps the other going.
 */
export async function keepRefreshCheckRunning(refreshJobs: RefreshJobs): Promise<void> {
    if (await refreshJobs.hasHourlyCheck()) {
        return;
    }

    console.error("The hourly refresh check was missing, so it was started again.");
    await refreshJobs.startHourlyCheck();
}

/** Whether each named thread config's refreshes are running, for moderators. */
export async function getRefreshStatus(
    refreshStatus: RefreshStatusStore,
    configNames: readonly string[],
): Promise<Readonly<Record<string, RefreshStatus>>> {
    return await refreshStatus.read(configNames);
}
