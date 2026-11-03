import { addMinutes, addSeconds } from "date-fns";
import { getSchedule } from "../configuration/index.js";
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

async function findNextRotationTime(
    ports: RotationPorts,
    failedConfigNames: readonly string[],
): Promise<Date | undefined> {
    const configs = (await ports.threadConfigs()).filter(
        (config): boolean => config.enabled && !failedConfigNames.includes(config.name),
    );
    const livePostIds = await ports.livePosts.all();
    const rotationTimes = await Promise.all(
        configs.map(async (config): Promise<Date | undefined> => {
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
 * When the next refresh is due: shortly after the earliest rotation time of a scheduled live post, or, when thread
 * configs just failed to refresh, at their retry time if that is sooner. Undefined when nothing needs a refresh.
 */
async function findNextRefreshTime(
    ports: RotationPorts,
    failedConfigNames: readonly string[],
): Promise<Date | undefined> {
    const retryAt = failedConfigNames.length > 0 ? addMinutes(new Date(), RETRY_DELAY_MINUTES) : undefined;
    const dueAt = earliest([await findNextRotationTime(ports, failedConfigNames), retryAt]);
    return dueAt === undefined
        ? undefined
        : addSeconds(new Date(Math.max(dueAt.getTime(), Date.now())), REFRESH_JOB_DELAY_SECONDS);
}

/** Replaces any pending refresh with one at the next refresh time; see findNextRefreshTime. */
export async function scheduleNextRefresh(
    ports: RotationPorts,
    failedConfigNames: readonly string[] = [],
): Promise<void> {
    // Read everything first, so thread configs that cannot be read fail before any pending refresh is cancelled.
    const refreshAt = await findNextRefreshTime(ports, failedConfigNames);
    await ports.refreshJobs.cancelAll();
    if (refreshAt === undefined) {
        await ports.refreshStatus.recordNextRefresh(undefined);
        console.log("No live post has a schedule, so no refresh is scheduled.");
        return;
    }

    await ports.refreshJobs.scheduleAt(refreshAt);
    await ports.refreshStatus.recordNextRefresh(refreshAt);
    console.log(`Next refresh scheduled for ${refreshAt.toISOString()}.`);
}

/** Replaces any pending refresh with one a second from now, e.g. to apply newly stored thread configs. */
export async function requestRefresh(ports: Pick<RotationPorts, "refreshJobs" | "refreshStatus">): Promise<void> {
    const refreshAt = addSeconds(new Date(), REQUESTED_REFRESH_DELAY_SECONDS);
    await ports.refreshJobs.cancelAll();
    await ports.refreshJobs.scheduleAt(refreshAt);
    await ports.refreshStatus.recordNextRefresh(refreshAt);
}

/** Starts the hourly refresh check, replacing any earlier one. */
export async function startRefreshCheck(refreshJobs: RefreshJobs): Promise<void> {
    await refreshJobs.startHourlyCheck();
}

/**
 * The hourly refresh check. Each refresh schedules the next, so a refresh that fails early leaves none pending; the
 * check then requests one, which retries what failed. A refresh already pending is left alone. One the check requests
 * can still overlap a refresh already running; thread locks keep that from rotating a thread twice.
 */
export async function ensureRefreshPending(
    ports: FailureAlertPorts & Pick<RotationPorts, "refreshJobs" | "refreshStatus">,
): Promise<void> {
    await alertingOnFailure(ports, async (): Promise<void> => {
        if (await ports.refreshJobs.isPending()) {
            return;
        }

        console.log("No refresh is pending, so the refresh check requested one.");
        await requestRefresh(ports);
    });
}

/** Whether refreshes are running, for moderators: what the last refresh did, and when the next is due. */
export async function getRefreshStatus(refreshStatus: RefreshStatusStore): Promise<RefreshStatus> {
    return await refreshStatus.read();
}
