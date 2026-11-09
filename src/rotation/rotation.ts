import type { ThreadConfig } from "../configuration/index.js";
import { isClearlyBelowCommentCap } from "./domain/rotationRules.js";
import { forgetThreadConfigs } from "./forgetThreadConfigs.js";
import type { Handover, LivePosts, RotationPorts } from "./ports.js";
import { alertingOnThreadFailure, describeFailure } from "./refreshFailures.js";
import { findConfigInForce, keepRefreshCheckRunning, scheduleNextRefresh, scheduleRetry } from "./refreshSchedule.js";
import { refreshThread } from "./threadRefresh.js";

function findConfigNameOfLivePost(livePostIds: Readonly<Record<string, string>>, postId: string): string | undefined {
    return Object.entries(livePostIds).find(
        ([, livePostId]: readonly [string, string]): boolean => livePostId === postId,
    )?.[0];
}

/** Runs `step`, logging its failure as `what` rather than throwing it, so an earlier failure stays the one reported. */
async function tryStep(what: string, step: () => Promise<void>): Promise<void> {
    try {
        await step();
    } catch (error: unknown) {
        console.error(`${what}:`, error);
    }
}

/**
 * After the thread config's refresh failed: records it as applied anyway, so it is retried after the retry delay
 * rather than at once as if it had changed, schedules the retry and records the failure. A failure here is logged
 * rather than thrown, so the refresh's own failure is the one reported; the hourly refresh check recovers.
 */
async function recordFailedRefresh(
    config: ThreadConfig,
    failure: Readonly<{ at: Date; error: unknown }>,
    ports: RotationPorts,
): Promise<void> {
    await tryStep(
        `Could not schedule a retry of thread config ${config.name}; the hourly refresh check requests a refresh if none is pending`,
        async (): Promise<void> => {
            await ports.appliedThreadConfigs.record(config);
            await scheduleRetry(config.name, ports);
        },
    );
    await tryStep(
        `Could not record the failed refresh of thread config ${config.name} in its refresh status`,
        async (): Promise<void> => {
            await ports.refreshStatus.recordFailure(config.name, failure.at, describeFailure(failure.error));
        },
    );
}

/**
 * After the thread config's refresh succeeded: records it as applied, schedules its next refresh, records the success,
 * and lets its next failure alert moderators again.
 */
async function recordSucceededRefresh(config: ThreadConfig, startedAt: Date, ports: RotationPorts): Promise<void> {
    await ports.appliedThreadConfigs.record(config);
    await scheduleNextRefresh(config.name, ports);
    await ports.refreshStatus.recordSuccess(config.name, startedAt);
    await ports.threadFailureAlert(config.name).release();
}

/** Refreshes the thread config, then records how it went; a skipped refresh leaves that to the one refreshing it. */
async function refreshAndRecord(config: ThreadConfig, ports: RotationPorts): Promise<void> {
    const startedAt = new Date();
    try {
        const outcome = await refreshThread(config, ports);
        if (outcome !== "skipped") {
            await recordSucceededRefresh(config, startedAt, ports);
            console.log(`Refresh of thread config ${config.name} finished: ${outcome}.`);
        }
    } catch (error: unknown) {
        await recordFailedRefresh(config, { at: startedAt, error }, ports);
        throw error;
    }
}

/**
 * One thread config's refresh: its live post published, rotated or brought up to date, the thread config recorded as
 * applied, its next refresh scheduled (a retry soon if this one failed), and the outcome recorded in its refresh
 * status. A failure alerts moderators about this thread config; a success lets its next failure alert them again. A
 * thread config no longer in force is forgotten instead.
 */
export async function refreshThreadConfig(configName: string, ports: RotationPorts): Promise<void> {
    await keepRefreshCheckRunning(ports.refreshJobs);
    const config = findConfigInForce(await ports.threadConfigs(), configName);
    if (config === undefined) {
        console.log(`Thread config ${configName} is no longer in force, so it is forgotten.`);
        await forgetThreadConfigs([configName], ports);
        return;
    }

    await alertingOnThreadFailure(ports, configName, async (): Promise<void> => {
        await refreshAndRecord(config, ports);
    });
}

async function refreshThreadOfLivePost(postId: string, ports: RotationPorts): Promise<void> {
    const configName = findConfigNameOfLivePost(await ports.livePosts.all(), postId);
    // A disabled thread config's live post is left alone: the next save or refresh check forgets it.
    if (configName !== undefined && findConfigInForce(await ports.threadConfigs(), configName) !== undefined) {
        await refreshThreadConfig(configName, ports);
    }
}

/** A new comment, as its event reports it. */
export interface NewComment {
    readonly postId: string;
    /** The post's comment count as the event reports it; 0 when the event does not say. */
    readonly reportedComments: number;
}

/**
 * After a new comment: if its post is a live post that has reached its comment cap, its thread config is refreshed
 * now, which rotates it. The count the comment's event reports spares a Reddit read for the many comments clearly below
 * the cap; past that, the post is read for its current count.
 */
export async function rotateIfCapReached(comment: NewComment, ports: RotationPorts): Promise<void> {
    const { postId } = comment;
    const commentCap = await ports.livePosts.getCommentCap(postId);
    if (commentCap === undefined || isClearlyBelowCommentCap(comment.reportedComments, commentCap)) {
        return;
    }

    const post = await ports.posts.get(postId);
    if (post.numberOfComments >= commentCap) {
        console.log(`Post ${post.id} has reached its comment cap of ${String(commentCap)}.`);
        await refreshThreadOfLivePost(postId, ports);
    }
}

/**
 * A deleted post needs nothing more from a handover: a handover retiring it stops there, and one whose new post it
 * was is forgotten.
 */
async function releaseDeletedPostFromHandovers(postId: string, livePosts: LivePosts): Promise<void> {
    await Promise.all(
        Object.entries(await livePosts.handovers()).map(
            async ([configName, handover]: readonly [string, Handover]): Promise<void> => {
                if (handover.newPostId === postId) {
                    console.log(
                        `Post ${postId} was deleted, so the handover of thread config ${configName} is forgotten.`,
                    );
                    await livePosts.forgetHandover(configName);
                } else if (handover.oldPostId === postId) {
                    console.log(
                        `Post ${postId} was deleted, so the handover of thread config ${configName} will not retire it.`,
                    );
                    await livePosts.saveHandover(configName, { newPostId: handover.newPostId });
                }
            },
        ),
    );
}

/**
 * A deleted or removed post that was a live post stops being recorded, and its comment cap is forgotten; no
 * unfinished handover acts on it any more. The next refresh check publishes the replacement.
 */
export async function forgetDeletedPost(postId: string, livePosts: LivePosts): Promise<void> {
    const configName = findConfigNameOfLivePost(await livePosts.all(), postId);
    if (configName !== undefined) {
        await livePosts.forget([configName], [postId]);
        console.log(
            `Live post ${postId} of thread config ${configName} was removed or deleted, so it is forgotten; the next refresh check, within the hour, publishes its replacement.`,
        );
    }

    await releaseDeletedPostFromHandovers(postId, livePosts);
}
