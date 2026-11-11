import { getSchedule } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { findCheckFinding } from "./domain/refreshRules.js";
import type { CheckFinding } from "./domain/refreshRules.js";
import { forgetRemovedThreadConfigs } from "./forgetThreadConfigs.js";
import type { Handover, PendingRefresh } from "./ports.js";
import { alertingOnRefreshFailure, describeFailure } from "./refreshFailures.js";
import { describeThreadConfigs, requestThreadRefresh } from "./refreshSchedule.js";
import type { RequestPorts } from "./refreshSchedule.js";
import { inRefreshOrder } from "./threadConfigOrder.js";

export type CheckPorts = RequestPorts;

/** What the refresh check reads once, for every thread config. */
interface CheckSnapshot {
    readonly now: Date;
    readonly pending: readonly PendingRefresh[];
    readonly livePostIds: Readonly<Record<string, string>>;
    readonly handovers: Readonly<Record<string, Handover>>;
}

type ThreadCheckFailure = Readonly<{ configName: string; error: unknown }>;

async function takeSnapshot(ports: CheckPorts): Promise<CheckSnapshot> {
    return {
        now: new Date(),
        pending: await ports.refreshJobs.pending(),
        livePostIds: await ports.livePosts.all(),
        handovers: await ports.livePosts.handovers(),
    };
}

/** The log line for a refresh the check requests, and whether it reports something that should not happen. */
function describeFinding(configName: string, finding: CheckFinding): Readonly<{ line: string; anomaly: boolean }> {
    const requested = `Requested a refresh of thread config ${configName}`;
    switch (finding.kind) {
        case "stuck":
            return {
                line: `The refresh of thread config ${configName} due at ${finding.stuckAt.toISOString()} has not run, so the refresh check replaced it.`,
                anomaly: true,
            };
        case "missing":
            return { line: `${requested}: no refresh of it was pending.`, anomaly: true };
        case "unapplied":
            return {
                line: `${requested}: its stored thread config was never applied, and no refresh of it was due.`,
                anomaly: true,
            };
        case "unfinished handover":
            return { line: `${requested}: its handover is unfinished, and no retry of it was pending.`, anomaly: true };
        case "no live post":
            return { line: `${requested}: it has no live post.`, anomaly: false };
    }
}

async function checkThread(config: ThreadConfig, snapshot: CheckSnapshot, ports: CheckPorts): Promise<void> {
    const finding = findCheckFinding(
        {
            applied: await ports.appliedThreadConfigs.matches(config),
            hasLivePost: Object.hasOwn(snapshot.livePostIds, config.name),
            hasUnfinishedHandover: Object.hasOwn(snapshot.handovers, config.name),
            hasSchedule: getSchedule(config) !== undefined,
            pendingRunTimes: snapshot.pending
                .filter((refresh: PendingRefresh): boolean => refresh.configName === config.name)
                .map((refresh: PendingRefresh): Date => refresh.runAt),
        },
        snapshot.now,
    );
    if (finding === undefined) {
        return;
    }

    await requestThreadRefresh(config.name, ports);
    const { line, anomaly } = describeFinding(config.name, finding);
    if (anomaly) {
        console.error(line);
    } else {
        console.log(line);
    }
}

/** Checks one thread config; a failure is logged and returned, so it cannot stop the others. */
async function checkIsolated(
    config: ThreadConfig,
    snapshot: CheckSnapshot,
    ports: CheckPorts,
): Promise<ThreadCheckFailure | undefined> {
    try {
        await checkThread(config, snapshot, ports);
        return undefined;
    } catch (error: unknown) {
        console.error(`The refresh check could not check thread config ${config.name}:`, error);
        return { configName: config.name, error };
    }
}

function describeCheckFailures(failures: readonly ThreadCheckFailure[]): Error {
    const details = failures.map((failure): string => `${failure.configName}: ${describeFailure(failure.error)}`);
    const subject = failures.length === 1 ? "thread config" : "thread configs";
    return new Error(`Could not check ${subject} ${details.join("; ")}`, { cause: failures[0]?.error });
}

/** What refreshes due at one time are for: named thread configs, and every one for a job from before the upgrade. */
function describeTargets(refreshes: readonly PendingRefresh[]): string {
    const configNames = refreshes.flatMap((refresh: PendingRefresh): string[] =>
        refresh.configName === undefined ? [] : [refresh.configName],
    );
    return [
        ...(configNames.length > 0 ? [describeThreadConfigs(configNames)] : []),
        ...(configNames.length < refreshes.length ? ["every thread config"] : []),
    ].join(" and ");
}

/** Every pending refresh in one line, grouped by when each is due: what monitoring reads every hour. */
function describePendingRefreshes(pending: readonly PendingRefresh[]): string {
    if (pending.length === 0) {
        return "No refreshes are pending.";
    }

    const groups = [...Map.groupBy(pending, (refresh: PendingRefresh): string => refresh.runAt.toISOString())].map(
        ([at, refreshes]: readonly [string, readonly PendingRefresh[]]): string =>
            `${at} for ${describeTargets(refreshes)}`,
    );
    return `Next refreshes: ${groups.join("; ")}.`;
}

/**
 * The hourly refresh check: each thread config in force has the refresh it needs pending and on time, thread configs
 * no longer in force are forgotten, then every pending refresh is restated in the log. One thread config's failure does
 * not stop the check of the others; the check then fails, naming it. A failure alerts moderators; a successful check
 * lets the next alert of its kind be sent.
 */
export async function checkRefreshes(ports: CheckPorts): Promise<void> {
    await alertingOnRefreshFailure(ports, async (): Promise<void> => {
        const snapshot = await takeSnapshot(ports);
        const configs = inRefreshOrder(await ports.threadConfigs());
        const results = await Promise.all(
            configs.map(
                async (config): Promise<ThreadCheckFailure | undefined> => await checkIsolated(config, snapshot, ports),
            ),
        );
        const failures = results.filter((result): result is ThreadCheckFailure => result !== undefined);
        await forgetRemovedThreadConfigs(ports);
        console.log(describePendingRefreshes(await ports.refreshJobs.pending()));
        if (failures.length > 0) {
            throw describeCheckFailures(failures);
        }
    });
    await ports.refreshFailureAlert.release();
}
