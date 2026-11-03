import { addSeconds } from "date-fns";
import { getSchedule } from "../configuration/index.js";
import { earliest, getRotationTime } from "./domain/rotationRules.js";
import type { RefreshJobs, RefreshStatus, RefreshStatusStore, RotationPorts } from "./ports.js";
import { alertingOnFailure } from "./refreshFailures.js";
import type { FailureAlertPorts } from "./refreshFailures.js";

// A refresh scheduled for a rotation time runs a few seconds after it, so the live post is due by then.
const REFRESH_JOB_DELAY_SECONDS = 5;
const REQUESTED_REFRESH_DELAY_SECONDS = 1;

async function findNextRotationTime(ports: RotationPorts): Promise<Date | undefined> {
    const configs = (await ports.threadConfigs()).filter((config): boolean => config.enabled);
    const livePostIds = await ports.livePosts.all();
    const rotationTimes = await Promise.all(
        configs.map(async (config): Promise<Date | undefined> => {
            const schedule = getSchedule(config);
            const postId = livePostIds[config.name];
            if (schedule === undefined || postId === undefined) {
                return undefined;
            }

            const post = await ports.posts.get(postId);
            return getRotationTime(post.createdAt, schedule);
        }),
    );

    return earliest(rotationTimes);
}

/** Replaces any pending refresh with one shortly after the earliest rotation time of a scheduled live post. */
export async function scheduleNextRefresh(ports: RotationPorts): Promise<void> {
    // Read everything first, so thread configs that cannot be read fail before any pending refresh is cancelled.
    const nextRotationTime = await findNextRotationTime(ports);
    await ports.refreshJobs.cancelAll();
    if (nextRotationTime === undefined) {
        await ports.refreshStatus.recordNextRefresh(undefined);
        console.log("No live post has a schedule, so no refresh is scheduled.");
        return;
    }

    const refreshAt = addSeconds(new Date(Math.max(nextRotationTime.getTime(), Date.now())), REFRESH_JOB_DELAY_SECONDS);
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
 * The hourly refresh check. Each refresh schedules the next, so a refresh that fails leaves none pending; the check
 * then requests one, which retries what failed. A refresh already pending is left alone, so the check never runs a
 * refresh alongside one.
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
