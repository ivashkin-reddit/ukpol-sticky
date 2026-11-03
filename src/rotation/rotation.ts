import { getSchedule, renderTitle } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { isDueForRotation, refreshOrder } from "./domain/rotationRules.js";
import type { LivePosts, ManagedPost, RotationPorts } from "./ports.js";
import { alertingOnFailure, describeFailure } from "./refreshFailures.js";
import { scheduleNextRefresh } from "./refreshSchedule.js";

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

async function retireLivePost(post: ManagedPost, config: ThreadConfig): Promise<void> {
    if (post.stickied) {
        await post.unsticky();
    }

    if (config.endNote != null && config.endNote !== "") {
        const comment = await post.addComment({ text: config.endNote });
        await comment.distinguish(true);
    }

    if (config.lockOnRefresh === true) {
        await post.lock();
    }
}

/** Publishes a new live post for the thread config, retiring the previous live post first if there is one. */
export async function rotateLivePost(
    previousPost: ManagedPost | undefined,
    config: ThreadConfig,
    ports: Pick<RotationPorts, "livePosts" | "posts">,
): Promise<void> {
    if (previousPost !== undefined) {
        console.log(`Rotating thread config ${config.name}: retiring live post ${previousPost.id}.`);
        await retireLivePost(previousPost, config);
    }

    const newPost = await ports.posts.publish({ title: renderTitle(config.title, new Date()), body: config.body });
    await newPost.distinguish();
    if (config.sticky === true) {
        await newPost.sticky();
    }

    await ports.livePosts.set(config.name, newPost.id);
    await ports.livePosts.storeCommentCap(newPost.id, config.maxComments);
    console.log(`Published live post ${newPost.id} for thread config ${config.name}.`);
}

/** What a refresh did for one thread config. */
type ThreadOutcome = "published" | "rotated" | "unchanged" | "updated";

/** Rotates a live post that is due; otherwise brings its body up to date and renews its comment cap. */
async function refreshLivePost(post: ManagedPost, config: ThreadConfig, ports: RotationPorts): Promise<ThreadOutcome> {
    const rotatesOn = { schedule: getSchedule(config), commentCap: config.maxComments };
    if (isDueForRotation(post, rotatesOn, Date.now())) {
        await rotateLivePost(post, config, ports);
        return "rotated";
    }

    const bodyChanged = post.body?.trim() !== config.body.trim();
    if (bodyChanged) {
        console.log(`Updating the body of live post ${post.id} for thread config ${config.name}.`);
        await post.edit({ text: config.body });
    }

    await ports.livePosts.storeCommentCap(post.id, config.maxComments);
    return bodyChanged ? "updated" : "unchanged";
}

async function refreshThread(config: ThreadConfig, ports: RotationPorts): Promise<ThreadOutcome> {
    const postId = await ports.livePosts.get(config.name);
    if (postId === undefined) {
        await rotateLivePost(undefined, config, ports);
        return "published";
    }

    return await refreshLivePost(await ports.posts.get(postId), config, ports);
}

// Sticky posts take Reddit's sticky slots in the order they are stickied, and each rotation unstickies the old live
// post before stickying its replacement, so thread configs refresh one at a time, in order.
async function refreshInOrder(configs: readonly ThreadConfig[], ports: RotationPorts): Promise<ThreadOutcome[]> {
    const [first, ...rest] = configs;
    if (first === undefined) {
        return [];
    }

    const outcome = await refreshThread(first, ports);
    return [outcome, ...(await refreshInOrder(rest, ports))];
}

function describeOutcomes(outcomes: readonly ThreadOutcome[]): string {
    const counts = (["rotated", "published", "updated", "unchanged"] as const).map(
        (kind): string => `${String(outcomes.filter((outcome): boolean => outcome === kind).length)} ${kind}`,
    );
    return `${String(outcomes.length)} thread configs: ${counts.join(", ")}`;
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

async function refreshEveryThread(ports: RotationPorts): Promise<void> {
    const configs = await ports.threadConfigs();
    if (configs.length === 0) {
        console.log("No thread configs are in force, so every live post is forgotten.");
        await forgetLivePosts(Object.keys(await ports.livePosts.all()), ports.livePosts);
        return;
    }

    const activeConfigs = refreshOrder(configs);
    const outcomes = await refreshInOrder(activeConfigs, ports);
    await scheduleNextRefresh(ports);
    await forgetRemovedThreads(activeConfigs, ports.livePosts);
    console.log(`Refresh complete for ${describeOutcomes(outcomes)}.`);
}

/**
 * One refresh: every enabled thread config's live post is published, rotated or brought up to date, live posts of
 * removed or disabled thread configs are forgotten, and the next refresh is scheduled. Its outcome is recorded in the
 * refresh status. A failure alerts moderators; a success lets the next failure alert them again.
 */
export async function refreshAllThreads(ports: RotationPorts): Promise<void> {
    const startedAt = new Date();
    try {
        await alertingOnFailure(ports, async (): Promise<void> => {
            await refreshEveryThread(ports);
        });
    } catch (error: unknown) {
        await ports.refreshStatus.recordFailure(startedAt, describeFailure(error));
        throw error;
    }

    await ports.refreshStatus.recordSuccess(startedAt);
    await ports.refreshFailureAlert.release();
}

async function refreshThreadOfLivePost(postId: string, ports: RotationPorts): Promise<void> {
    const configName = findConfigNameOfLivePost(await ports.livePosts.all(), postId);
    if (configName === undefined) {
        return;
    }

    const config = (await ports.threadConfigs()).find((candidate): boolean => candidate.name === configName);
    if (config === undefined) {
        return;
    }

    await refreshThread(config, ports);
    await scheduleNextRefresh(ports);
}

/** After a comment on `postId`: if it is a live post that has reached its comment cap, its thread is rotated now. */
export async function rotateIfCapReached(postId: string, ports: RotationPorts): Promise<void> {
    const commentCap = await ports.livePosts.getCommentCap(postId);
    if (commentCap === undefined) {
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

/** A deleted post that was a live post stops being recorded, and its comment cap is forgotten. */
export async function forgetDeletedPost(postId: string, livePosts: LivePosts): Promise<void> {
    const configName = findConfigNameOfLivePost(await livePosts.all(), postId);
    if (configName === undefined) {
        return;
    }

    await livePosts.forget([configName], [postId]);
}
