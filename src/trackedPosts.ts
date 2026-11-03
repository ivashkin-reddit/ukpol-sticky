import { addDays } from "date-fns";
import type { RedisPort } from "./ports.js";

// Both keys are live state in every subreddit the app is installed on: config name -> ID of the post it manages,
// and each managed post's comment cap.
const STICKY_POST_STORE = "StickyPostStore";
const COMMENT_CAP_TTL_DAYS = 28;

export type TrackedPostContext = Readonly<{ redis: RedisPort<"del" | "hDel" | "hGetAll"> }>;

function getCommentCapKey(postId: string): string {
    return `CommentCap:${postId}`;
}

/** Config name -> ID of the post currently managed for it. */
export async function getTrackedPosts(
    context: Readonly<{ redis: RedisPort<"hGetAll"> }>,
): Promise<Readonly<Record<string, string>>> {
    return await context.redis.hGetAll(STICKY_POST_STORE);
}

export async function getTrackedPostId(
    context: Readonly<{ redis: RedisPort<"hGet"> }>,
    configName: string,
): Promise<string | undefined> {
    return await context.redis.hGet(STICKY_POST_STORE, configName);
}

export async function getTrackedConfigNames(context: Readonly<{ redis: RedisPort<"hKeys"> }>): Promise<string[]> {
    return await context.redis.hKeys(STICKY_POST_STORE);
}

export async function trackPost(
    context: Readonly<{ redis: RedisPort<"hSet"> }>,
    configName: string,
    postId: string,
): Promise<void> {
    await context.redis.hSet(STICKY_POST_STORE, { [configName]: postId });
}

export function findTrackedConfigName(
    trackedPosts: Readonly<Record<string, string>>,
    postId: string,
): string | undefined {
    return Object.entries(trackedPosts).find(
        ([, trackedPostId]: readonly [string, string]): boolean => trackedPostId === postId,
    )?.[0];
}

export async function storeCommentCap(
    postId: string,
    maxComments: number,
    context: Readonly<{ redis: RedisPort<"set"> }>,
): Promise<void> {
    await context.redis.set(getCommentCapKey(postId), JSON.stringify(maxComments), {
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

/** Stops tracking the named configs and forgets their posts' comment caps. */
export async function deleteTrackedPosts(configNames: readonly string[], context: TrackedPostContext): Promise<void> {
    if (configNames.length === 0) {
        return;
    }

    const trackedPosts = await getTrackedPosts(context);
    const commentCapKeys = configNames.flatMap((configName): string[] => {
        const postId = trackedPosts[configName];
        return postId === undefined ? [] : [getCommentCapKey(postId)];
    });

    await context.redis.hDel(STICKY_POST_STORE, [...configNames]);
    if (commentCapKeys.length > 0) {
        await context.redis.del(...commentCapKeys);
    }
}

export async function handlePostDelete(
    event: Readonly<{ postId: string }>,
    context: TrackedPostContext,
): Promise<void> {
    const configName = findTrackedConfigName(await getTrackedPosts(context), event.postId);
    if (configName === undefined) {
        return;
    }

    await context.redis.hDel(STICKY_POST_STORE, [configName]);
    await context.redis.del(getCommentCapKey(event.postId));
}
