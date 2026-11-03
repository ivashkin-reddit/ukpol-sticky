import { addDays } from "date-fns";
import type { RedisPort } from "../platform/index.js";

// Both keys are live state in every installed subreddit: thread config name -> ID of its live post, and each live
// post's comment cap.
const STICKY_POST_STORE = "StickyPostStore";
const COMMENT_CAP_TTL_DAYS = 28;

export type LivePostCleanupContext = Readonly<{ redis: RedisPort<"del" | "hDel" | "hGetAll"> }>;

function getCommentCapKey(postId: string): string {
    return `CommentCap:${postId}`;
}

/** Thread config name -> ID of its live post. */
export async function getLivePostIds(
    context: Readonly<{ redis: RedisPort<"hGetAll"> }>,
): Promise<Readonly<Record<string, string>>> {
    return await context.redis.hGetAll(STICKY_POST_STORE);
}

export async function getLivePostId(
    context: Readonly<{ redis: RedisPort<"hGet"> }>,
    configName: string,
): Promise<string | undefined> {
    return await context.redis.hGet(STICKY_POST_STORE, configName);
}

export async function getConfigNamesWithLivePosts(context: Readonly<{ redis: RedisPort<"hKeys"> }>): Promise<string[]> {
    return await context.redis.hKeys(STICKY_POST_STORE);
}

export async function setLivePost(
    context: Readonly<{ redis: RedisPort<"hSet"> }>,
    configName: string,
    postId: string,
): Promise<void> {
    await context.redis.hSet(STICKY_POST_STORE, { [configName]: postId });
}

export function findConfigNameOfLivePost(
    livePostIds: Readonly<Record<string, string>>,
    postId: string,
): string | undefined {
    return Object.entries(livePostIds).find(
        ([, livePostId]: readonly [string, string]): boolean => livePostId === postId,
    )?.[0];
}

export async function storeCommentCap(
    postId: string,
    commentCap: number,
    context: Readonly<{ redis: RedisPort<"set"> }>,
): Promise<void> {
    await context.redis.set(getCommentCapKey(postId), JSON.stringify(commentCap), {
        expiration: addDays(new Date(), COMMENT_CAP_TTL_DAYS),
    });
}

export async function getCommentCap(
    postId: string,
    context: Readonly<{ redis: RedisPort<"get"> }>,
): Promise<number | undefined> {
    const stored = await context.redis.get(getCommentCapKey(postId));
    if (stored === undefined) {
        return undefined;
    }

    const cap: unknown = JSON.parse(stored);
    if (typeof cap !== "number") {
        throw new TypeError(`Comment cap for post ${postId} is not a number: ${stored}`);
    }

    return cap;
}

/** Stops tracking the named thread configs' live posts and forgets their comment caps. */
export async function forgetLivePosts(configNames: readonly string[], context: LivePostCleanupContext): Promise<void> {
    if (configNames.length === 0) {
        return;
    }

    const livePostIds = await getLivePostIds(context);
    const commentCapKeys = configNames.flatMap((configName): string[] => {
        const postId = livePostIds[configName];
        return postId === undefined ? [] : [getCommentCapKey(postId)];
    });

    await context.redis.hDel(STICKY_POST_STORE, [...configNames]);
    if (commentCapKeys.length > 0) {
        await context.redis.del(...commentCapKeys);
    }
}

/** A deleted post that was a live post stops being tracked, and its comment cap is forgotten. */
export async function forgetDeletedPost(postId: string, context: LivePostCleanupContext): Promise<void> {
    const configName = findConfigNameOfLivePost(await getLivePostIds(context), postId);
    if (configName === undefined) {
        return;
    }

    await context.redis.hDel(STICKY_POST_STORE, [configName]);
    await context.redis.del(getCommentCapKey(postId));
}
