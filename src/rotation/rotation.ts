import type { ThreadConfig } from "../configuration/index.js";
import { isClearlyBelowCommentCap, refreshOrder } from "./domain/rotationRules.js";
import type { Handover, LivePosts, RotationPorts } from "./ports.js";
import { alertingOnFailure, describeFailure } from "./refreshFailures.js";
import { keepRefreshCheckRunning, scheduleNextRefresh, scheduleRetry } from "./refreshSchedule.js";
import { refreshThread } from "./threadRefresh.js";
import type { ThreadOutcome } from "./threadRefresh.js";

function findConfigNameOfLivePost(livePostIds: Readonly<Record<string, string>>, postId: string): string | undefined {
    return Object.entries(livePostIds).find(
        ([, livePostId]: readonly [string, string]): boolean => livePostId === postId,
    )?.[0];
}

/** Stops recording the named thread configs' live posts and forgets their comment caps. */
async function forgetLivePosts(configNames: readonly string[], livePosts: LivePosts): Promise<void> {
    if (configNames.length === 0) {
        return;
    }

    const livePostIds = await livePosts.all();
    const postIds = configNames.flatMap((configName): string[] => {
        const postId = livePostIds[configName];
        return postId === undefined ? [] : [postId];
    });
    await livePosts.forget(configNames, postIds);
}

type ThreadResult =
    | Readonly<{ configName: string; outcome: "failed"; error: unknown }>
    | Readonly<{ configName: string; outcome: ThreadOutcome }>;

type ThreadFailure = Extract<ThreadResult, Readonly<{ outcome: "failed" }>>;

function isFailure(result: ThreadResult): result is ThreadFailure {
    return result.outcome === "failed";
}

/** Refreshes one thread config; a failure is logged and returned, so it cannot stop the others. */
async function refreshIsolated(config: ThreadConfig, ports: RotationPorts): Promise<ThreadResult> {
    try {
        return { configName: config.name, outcome: await refreshThread(config, ports) };
    } catch (error: unknown) {
        console.error(`Could not refresh thread config ${config.name}:`, error);
        return { configName: config.name, outcome: "failed", error };
    }
}

// Sticky posts take Reddit's sticky slots in the order they are stickied, and each rotation unstickies the old live
// post before stickying its replacement, so thread configs refresh one at a time, in order.
async function refreshInOrder(configs: readonly ThreadConfig[], ports: RotationPorts): Promise<ThreadResult[]> {
    const [first, ...rest] = configs;
    if (first === undefined) {
        return [];
    }

    const result = await refreshIsolated(first, ports);
    return [result, ...(await refreshInOrder(rest, ports))];
}

function describeResults(results: readonly ThreadResult[]): string {
    const counts = (["rotated", "published", "resumed", "updated", "unchanged", "skipped", "failed"] as const).flatMap(
        (kind): string[] => {
            const count = results.filter((result): boolean => result.outcome === kind).length;
            return count === 0 ? [] : [`${String(count)} ${kind}`];
        },
    );
    const total = `${String(results.length)} thread configs`;
    return counts.length === 0 ? total : `${total}: ${counts.join(", ")}`;
}

function describeFailures(failures: readonly ThreadFailure[]): Error {
    const details = failures.map((failure): string => `${failure.configName}: ${describeFailure(failure.error)}`);
    const subject = failures.length === 1 ? "thread config" : "thread configs";
    return new Error(`Could not refresh ${subject} ${details.join("; ")}`, { cause: failures[0]?.error });
}

async function forgetRemovedThreads(activeConfigs: readonly ThreadConfig[], livePosts: LivePosts): Promise<void> {
    const configNames = await livePosts.configNames();
    const removedConfigNames = configNames.filter(
        (configName): boolean => !activeConfigs.some((config): boolean => config.name === configName),
    );
    if (removedConfigNames.length > 0) {
        console.log(
            `Forgetting the live posts of removed or disabled thread configs: ${removedConfigNames.join(", ")}.`,
        );
        await forgetLivePosts(removedConfigNames, livePosts);
    }
}

/** Schedules the next refresh (retrying failed thread configs), forgets removed ones, then reports any failure. */
async function finishRefresh(results: readonly ThreadResult[], ports: RotationPorts): Promise<void> {
    const failures = results.filter(isFailure);
    await scheduleNextRefresh(
        ports,
        failures.map((failure): string => failure.configName),
    );
    // Read again, not taken from the start of the refresh: a thread config added meanwhile may have a live post that
    // another invocation published, which a stale list would forget.
    await forgetRemovedThreads(refreshOrder(await ports.threadConfigs()), ports.livePosts);
    console.log(`Refresh finished for ${describeResults(results)}.`);
    if (failures.length > 0) {
        throw describeFailures(failures);
    }
}

async function refreshEveryThread(ports: RotationPorts): Promise<void> {
    await keepRefreshCheckRunning(ports.refreshJobs);
    const configs = await ports.threadConfigs();
    if (configs.length === 0) {
        console.log("No thread configs are in force, so every live post is forgotten.");
        await forgetLivePosts(await ports.livePosts.configNames(), ports.livePosts);
        await scheduleNextRefresh(ports);
        return;
    }

    await finishRefresh(await refreshInOrder(refreshOrder(configs), ports), ports);
}

/**
 * One refresh: every enabled thread config's live post is published, rotated or brought up to date, live posts of
 * removed or disabled thread configs are forgotten, and the next refresh is scheduled. A thread config that fails
 * does not stop the others; it is retried by an earlier next refresh. The outcome is recorded in the refresh status.
 * A failure alerts moderators; a full success lets the next failure alert them again.
 */
export async function refreshAllThreads(ports: RotationPorts): Promise<void> {
    const startedAt = new Date();
    try {
        await alertingOnFailure(ports, async (): Promise<void> => {
            await refreshEveryThread(ports);
        });
    } catch (error: unknown) {
        // A failure to record it is logged rather than thrown, so the refresh's own failure is the one reported.
        await ports.refreshStatus
            .recordFailure(startedAt, describeFailure(error))
            .catch((statusError: unknown): void => {
                console.error("Could not record the failed refresh in the refresh status:", statusError);
            });
        throw error;
    }

    await ports.refreshStatus.recordSuccess(startedAt);
    await ports.refreshFailureAlert.release();
}

/**
 * Refreshes one thread config; if that fails, makes sure a retry is pending first. Nothing else retries this rotation
 * soon: a pending refresh may be days off. A failure to schedule the retry is logged rather than thrown, so the
 * rotation's own failure is the one reported; the hourly refresh check requests a refresh if none is pending.
 */
async function refreshOrScheduleRetry(config: ThreadConfig, ports: RotationPorts): Promise<ThreadOutcome> {
    try {
        return await refreshThread(config, ports);
    } catch (error: unknown) {
        await scheduleRetry(ports, config.name).catch((scheduleError: unknown): void => {
            console.error(
                `Could not schedule a retry of thread config ${config.name}; the hourly refresh check requests a refresh if none is pending:`,
                scheduleError,
            );
        });
        throw error;
    }
}

/** Refreshes one thread config, then schedules the next refresh: a retry soon if the refresh failed. */
async function refreshThenReschedule(config: ThreadConfig, ports: RotationPorts): Promise<void> {
    // A skipped refresh leaves scheduling to the invocation that is refreshing the thread config.
    if ((await refreshOrScheduleRetry(config, ports)) !== "skipped") {
        await scheduleNextRefresh(ports);
    }
}

async function refreshThreadOfLivePost(postId: string, ports: RotationPorts): Promise<void> {
    const configName = findConfigNameOfLivePost(await ports.livePosts.all(), postId);
    if (configName === undefined) {
        return;
    }

    const config = (await ports.threadConfigs()).find(
        (candidate): boolean => candidate.name === configName && candidate.enabled,
    );
    if (config === undefined) {
        return;
    }

    await refreshThenReschedule(config, ports);
}

/** A new comment, as its event reports it. */
export interface NewComment {
    readonly postId: string;
    /** The post's comment count as the event reports it; 0 when the event does not say. */
    readonly reportedComments: number;
}

/**
 * After a new comment: if its post is a live post that has reached its comment cap, its thread is rotated now. The
 * count the comment's event reports spares a Reddit read for the many comments clearly below the cap; past that, the
 * post is read for its current count.
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
        await alertingOnFailure(ports, async (): Promise<void> => {
            await refreshThreadOfLivePost(postId, ports);
        });
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
 * A deleted post that was a live post stops being recorded, and its comment cap is forgotten; no unfinished handover
 * acts on it any more.
 */
export async function forgetDeletedPost(postId: string, livePosts: LivePosts): Promise<void> {
    const configName = findConfigNameOfLivePost(await livePosts.all(), postId);
    if (configName !== undefined) {
        await livePosts.forget([configName], [postId]);
    }

    await releaseDeletedPostFromHandovers(postId, livePosts);
}
