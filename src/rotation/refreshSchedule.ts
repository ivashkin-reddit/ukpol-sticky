import { addMinutes, addSeconds, subMinutes } from "date-fns";
import { getSchedule } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { earliest, getRotationTime } from "./domain/rotationRules.js";
import type { RefreshJobs, RefreshStatus, RefreshStatusStore, RotationPorts } from "./ports.js";
import { alertingOnFailure } from "./refreshFailures.js";
import type { FailureAlertPorts } from "./refreshFailures.js";

// A refresh scheduled for a rotation time runs a few seconds after it, so the live post is due by then.
const REFRESH_JOB_DELAY_SECONDS = 5;
const REQUESTED_REFRESH_DELAY_SECONDS = 1;
// How soon a thread config that failed is retried. Its own rotation time is left out of the reckoning, since a
// thread config that keeps failing while overdue would otherwise bring the next refresh round every few seconds.
const RETRY_DELAY_MINUTES = 15;
// A pending refresh this long past its time is taken as stuck: Devvit runs a job within about a minute of its time.
const STUCK_AFTER_MINUTES = 10;

/** Whether a refresh due at `runAt` can still be expected to run as of `now`: it is not long past its time. */
function isOnTime(runAt: Date, now: Date): boolean {
    return runAt.getTime() > subMinutes(now, STUCK_AFTER_MINUTES).getTime();
}

async function findNextRotationTime(
    configs: readonly ThreadConfig[],
    ports: RotationPorts,
    failedConfigNames: readonly string[],
): Promise<Date | undefined> {
    const livePostIds = await ports.livePosts.all();
    const rotationTimes = await Promise.all(
        configs
            .filter((config): boolean => config.enabled && !failedConfigNames.includes(config.name))
            .map(async (config): Promise<Date | undefined> => {
                const postId = livePostIds[config.name];
                if (postId === undefined) {
                    // Its live post is still to be published: added while a refresh ran, or deleted since.
                    return new Date();
                }

                const schedule = getSchedule(config);
                if (schedule === undefined) {
                    return undefined;
                }

                const post = await ports.posts.get(postId);
                return getRotationTime(post.createdAt, schedule);
            }),
    );

    return earliest(rotationTimes);
}

/**
 * When the next refresh is due: at once while the thread configs in force are not the ones the last refresh applied;
 * otherwise shortly after the earliest rotation time of a scheduled live post, or, when thread configs just failed to
 * refresh, at their retry time if that is sooner. Undefined when nothing needs a refresh.
 */
async function findNextRefreshTime(
    ports: RotationPorts,
    failedConfigNames: readonly string[],
): Promise<Date | undefined> {
    const configs = await ports.threadConfigs();
    // Thread configs stored since the last refresh, as by a config page save, are due now even when the refresh their
    // save requested is the pending refresh being replaced.
    const unappliedAt = (await ports.appliedThreadConfigs.matches(configs)) ? undefined : new Date();
    const retryAt = failedConfigNames.length > 0 ? addMinutes(new Date(), RETRY_DELAY_MINUTES) : undefined;
    const dueAt = earliest([unappliedAt, await findNextRotationTime(configs, ports, failedConfigNames), retryAt]);
    return dueAt === undefined
        ? undefined
        : addSeconds(new Date(Math.max(dueAt.getTime(), Date.now())), REFRESH_JOB_DELAY_SECONDS);
}

/** Replaces any pending refresh with one at the next refresh time; see findNextRefreshTime. */
export async function scheduleNextRefresh(
    ports: RotationPorts,
    failedConfigNames: readonly string[] = [],
): Promise<void> {
    // Read everything first, so thread configs that cannot be read fail before any pending refresh is replaced.
    const refreshAt = await findNextRefreshTime(ports, failedConfigNames);
    if (refreshAt === undefined) {
        await ports.refreshJobs.cancelAll();
        await ports.refreshStatus.recordNextRefresh(undefined);
        console.log("No live post has a schedule, so no refresh is scheduled.");
        return;
    }

    await ports.refreshJobs.replaceWith(refreshAt);
    await ports.refreshStatus.recordNextRefresh(refreshAt);
    console.log(`Next refresh scheduled for ${refreshAt.toISOString()}.`);
}

/**
 * Makes sure a refresh retries the failed thread config within the retry delay, unless an on-time refresh already
 * pending runs before then. While Reddit is down every comment on a full thread fails the same way, and rescheduling
 * for each would churn the scheduler into its limit of 60 new jobs a minute.
 */
export async function scheduleRetry(ports: RotationPorts, failedConfigName: string): Promise<void> {
    const now = new Date();
    const retryBy = addSeconds(addMinutes(now, RETRY_DELAY_MINUTES), REFRESH_JOB_DELAY_SECONDS);
    const pendingRunTimes = await ports.refreshJobs.pendingRunTimes();
    if (pendingRunTimes.some((runAt: Date): boolean => isOnTime(runAt, now) && runAt.getTime() <= retryBy.getTime())) {
        return;
    }

    await scheduleNextRefresh(ports, [failedConfigName]);
}

/** Replaces any pending refresh with one a second from now, e.g. to apply newly stored thread configs. */
export async function requestRefresh(ports: Pick<RotationPorts, "refreshJobs" | "refreshStatus">): Promise<void> {
    const refreshAt = addSeconds(new Date(), REQUESTED_REFRESH_DELAY_SECONDS);
    await ports.refreshJobs.replaceWith(refreshAt);
    await ports.refreshStatus.recordNextRefresh(refreshAt);
}

/** Starts the hourly refresh check, replacing any earlier one. */
export async function startRefreshCheck(refreshJobs: RefreshJobs): Promise<void> {
    await refreshJobs.startHourlyCheck();
}

/**
 * Starts the hourly refresh check again if it has gone. Every refresh calls this, and the check requests a refresh
 * when none will run, so each keeps the other going.
 */
export async function keepRefreshCheckRunning(refreshJobs: RefreshJobs): Promise<void> {
    if (await refreshJobs.hasHourlyCheck()) {
        return;
    }

    console.error("The hourly refresh check was missing, so it was started again.");
    await refreshJobs.startHourlyCheck();
}

/**
 * The hourly refresh check. Each refresh schedules the next, so a refresh that fails early leaves none pending; the
 * check then requests one, which retries what failed. A pending refresh long past its time has not run and will not,
 * so the check replaces it too; one still on time is left alone. A refresh the check requests can overlap one already
 * running; thread locks keep that from rotating a thread twice.
 */
export async function ensureRefreshPending(
    ports: FailureAlertPorts & Pick<RotationPorts, "refreshJobs" | "refreshStatus">,
): Promise<void> {
    await alertingOnFailure(ports, async (): Promise<void> => {
        const now = new Date();
        const pendingRunTimes = await ports.refreshJobs.pendingRunTimes();
        if (pendingRunTimes.some((runAt: Date): boolean => isOnTime(runAt, now))) {
            return;
        }

        const [stuckAt] = pendingRunTimes;
        if (stuckAt === undefined) {
            console.log("No refresh is pending, so the refresh check requested one.");
        } else {
            console.error(`The refresh due at ${stuckAt.toISOString()} has not run, so the refresh check replaced it.`);
        }

        await requestRefresh(ports);
    });
}

/** Whether refreshes are running, for moderators: what the last refresh did, and when the next is due. */
export async function getRefreshStatus(refreshStatus: RefreshStatusStore): Promise<RefreshStatus> {
    return await refreshStatus.read();
}
