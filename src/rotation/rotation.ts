import { addSeconds } from "date-fns";
import { getSchedule, getThreadConfigs, renderTitle } from "../configuration/index.js";
import type { ConfigReadContext, ThreadConfig } from "../configuration/index.js";
import { getSubredditName } from "../platform/index.js";
import type { RedisPort, SubredditNamePort } from "../platform/index.js";
import {
    findConfigNameOfLivePost,
    forgetLivePosts,
    getCommentCap,
    getConfigNamesWithLivePosts,
    getLivePostId,
    getLivePostIds,
    setLivePost,
    storeCommentCap,
} from "./livePosts.js";
import type { LivePostCleanupContext } from "./livePosts.js";
import { cancelRefreshJobs, scheduleRefresh } from "./refreshJob.js";
import type { RefreshJobContext } from "./refreshJob.js";
import { earliest, getRotationTime, isDueForRotation, refreshOrder } from "./rotationRules.js";

const REFRESH_JOB_DELAY_SECONDS = 5;

export interface ManagedComment {
    readonly distinguish: (makeSticky?: boolean) => Promise<void>;
}

/** The parts of a Devvit Post that rotation reads and calls. */
export interface ManagedPost {
    readonly id: string;
    readonly createdAt: Date;
    readonly numberOfComments: number;
    readonly body?: string | undefined;
    readonly stickied: boolean;
    readonly addComment: (options: Readonly<{ text: string }>) => Promise<ManagedComment>;
    readonly distinguish: () => Promise<void>;
    readonly edit: (options: Readonly<{ text: string }>) => Promise<void>;
    readonly lock: () => Promise<void>;
    readonly sticky: () => Promise<void>;
    readonly unsticky: () => Promise<void>;
}

export type PublishContext = SubredditNamePort &
    Readonly<{
        redis: RedisPort<"hSet" | "set">;
        reddit: Readonly<{
            submitPost: (
                options: Readonly<{ subredditName: string; text: string; title: string }>,
            ) => Promise<ManagedPost>;
        }>;
    }>;

export type RotationContext = ConfigReadContext &
    LivePostCleanupContext &
    PublishContext &
    RefreshJobContext &
    Readonly<{
        redis: RedisPort<"get" | "hGet" | "hKeys">;
        reddit: Readonly<{ getPostById: (id: string) => Promise<ManagedPost> }>;
    }>;

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
    context: PublishContext,
): Promise<void> {
    if (previousPost !== undefined) {
        await retireLivePost(previousPost, config);
    }

    const newPost = await context.reddit.submitPost({
        title: renderTitle(config.title, new Date()),
        text: config.body,
        subredditName: await getSubredditName(context),
    });

    await newPost.distinguish();
    if (config.sticky === true) {
        await newPost.sticky();
    }

    await setLivePost(context, config.name, newPost.id);
    await storeCommentCap(newPost.id, config.maxComments, context);
    console.log(`Created new post for config ${config.name} with ID ${newPost.id}.`);
}

/** Rotates a live post that is due; otherwise brings its body up to date and renews its comment cap. */
async function refreshLivePost(post: ManagedPost, config: ThreadConfig, context: RotationContext): Promise<void> {
    if (isDueForRotation(post, config, Date.now())) {
        await rotateLivePost(post, config, context);
        return;
    }

    if (post.body?.trim() !== config.body.trim()) {
        console.log(`Updating post for config ${config.name} as body has changed.`);
        await post.edit({ text: config.body });
    }

    await storeCommentCap(post.id, config.maxComments, context);
}

async function refreshThread(config: ThreadConfig, context: RotationContext): Promise<void> {
    const postId = await getLivePostId(context, config.name);
    if (postId === undefined) {
        await rotateLivePost(undefined, config, context);
        return;
    }

    await refreshLivePost(await context.reddit.getPostById(postId), config, context);
}

// Sticky posts take Reddit's sticky slots in the order they are stickied, and each rotation unstickies the old live
// post before stickying its replacement, so thread configs refresh one at a time, in order.
async function refreshInOrder(configs: readonly ThreadConfig[], context: RotationContext): Promise<void> {
    const [first, ...rest] = configs;
    if (first === undefined) {
        return;
    }

    await refreshThread(first, context);
    await refreshInOrder(rest, context);
}

async function findNextRotationTime(context: RotationContext): Promise<Date | undefined> {
    const configs = (await getThreadConfigs(context)).filter((config): boolean => config.enabled);
    const livePostIds = await getLivePostIds(context);
    const rotationTimes = await Promise.all(
        configs.map(async (config): Promise<Date | undefined> => {
            const schedule = getSchedule(config);
            const postId = livePostIds[config.name];
            if (schedule === undefined || postId === undefined) {
                return undefined;
            }

            const post = await context.reddit.getPostById(postId);
            return getRotationTime(post.createdAt, schedule);
        }),
    );

    return earliest(rotationTimes);
}

/** Replaces any pending refresh with one shortly after the earliest rotation time of a scheduled live post. */
export async function scheduleNextRefresh(context: RotationContext): Promise<void> {
    // Read everything first, so thread configs that cannot be read fail before any pending refresh is cancelled.
    const nextRotationTime = await findNextRotationTime(context);
    await cancelRefreshJobs(context);
    if (nextRotationTime === undefined) {
        console.log("No scheduled sticky post refreshes found.");
        return;
    }

    const refreshAt = new Date(Math.max(nextRotationTime.getTime(), Date.now()));
    await scheduleRefresh(context, addSeconds(refreshAt, REFRESH_JOB_DELAY_SECONDS));
    console.log(`Scheduled next sticky post refresh at ${refreshAt.toISOString()}.`);
}

async function forgetRemovedThreads(activeConfigs: readonly ThreadConfig[], context: RotationContext): Promise<void> {
    const configNames = await getConfigNamesWithLivePosts(context);
    const removedConfigNames = configNames.filter(
        (configName): boolean => !activeConfigs.some((config): boolean => config.name === configName),
    );
    if (removedConfigNames.length > 0) {
        console.log(`Removing stale sticky post configurations: ${removedConfigNames.join(", ")}`);
        await forgetLivePosts(removedConfigNames, context);
    }
}

/**
 * One refresh: every enabled thread config's live post is published, rotated or brought up to date, live posts of
 * removed or disabled thread configs are forgotten, and the next refresh is scheduled.
 */
export async function refreshAllThreads(context: RotationContext): Promise<void> {
    const configs = await getThreadConfigs(context);
    if (configs.length === 0) {
        console.log("No sticky post configurations found.");
        await forgetLivePosts(Object.keys(await getLivePostIds(context)), context);
        return;
    }

    const activeConfigs = refreshOrder(configs);
    await refreshInOrder(activeConfigs, context);
    await scheduleNextRefresh(context);
    await forgetRemovedThreads(activeConfigs, context);
}

async function refreshThreadOfLivePost(postId: string, context: RotationContext): Promise<void> {
    const configName = findConfigNameOfLivePost(await getLivePostIds(context), postId);
    if (configName === undefined) {
        return;
    }

    const config = (await getThreadConfigs(context)).find((candidate): boolean => candidate.name === configName);
    if (config === undefined) {
        return;
    }

    await refreshThread(config, context);
    await scheduleNextRefresh(context);
}

/** After a comment on `postId`: if it is a live post that has reached its comment cap, its thread is rotated now. */
export async function rotateIfCapReached(postId: string, context: RotationContext): Promise<void> {
    const commentCap = await getCommentCap(postId, context);
    if (commentCap === undefined) {
        return;
    }

    const post = await context.reddit.getPostById(postId);
    if (post.numberOfComments >= commentCap) {
        console.log(`Post ${post.id} has reached the comment cap of ${String(commentCap)}.`);
        await refreshThreadOfLivePost(postId, context);
    }
}
