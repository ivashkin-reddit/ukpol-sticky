import { addDays } from "date-fns";
import type { RedisPort } from "../../platform/index.js";
import type { LivePosts } from "../ports.js";

// Live state in every installed subreddit, so these keys stay stable: thread config name -> ID of its live post, and
// each live post's comment cap.
const STICKY_POST_STORE = "StickyPostStore";
const COMMENT_CAP_TTL_DAYS = 28;

export type LivePostsRedis = RedisPort<"del" | "get" | "hDel" | "hGet" | "hGetAll" | "hKeys" | "hSet" | "set">;

function getCommentCapKey(postId: string): string {
    return `CommentCap:${postId}`;
}

async function getCommentCap(redis: LivePostsRedis, postId: string): Promise<number | undefined> {
    const stored = await redis.get(getCommentCapKey(postId));
    if (stored === undefined) {
        return undefined;
    }

    const cap: unknown = JSON.parse(stored);
    if (typeof cap !== "number") {
        throw new TypeError(`Comment cap for post ${postId} is not a number: ${stored}`);
    }

    return cap;
}

async function forget(
    redis: LivePostsRedis,
    configNames: readonly string[],
    postIds: readonly string[],
): Promise<void> {
    await redis.hDel(STICKY_POST_STORE, [...configNames]);
    if (postIds.length > 0) {
        await redis.del(...postIds.map((postId): string => getCommentCapKey(postId)));
    }
}

/** Live posts in the subreddit's Redis: one hash of live post IDs, and an expiring key per comment cap. */
export function redisLivePosts(redis: LivePostsRedis): LivePosts {
    return {
        all: async (): Promise<Readonly<Record<string, string>>> => await redis.hGetAll(STICKY_POST_STORE),
        get: async (configName: string): Promise<string | undefined> => await redis.hGet(STICKY_POST_STORE, configName),
        configNames: async (): Promise<readonly string[]> => await redis.hKeys(STICKY_POST_STORE),
        set: async (configName: string, postId: string): Promise<void> => {
            await redis.hSet(STICKY_POST_STORE, { [configName]: postId });
        },
        forget: async (configNames: readonly string[], postIds: readonly string[]): Promise<void> => {
            await forget(redis, configNames, postIds);
        },
        getCommentCap: async (postId: string): Promise<number | undefined> => await getCommentCap(redis, postId),
        storeCommentCap: async (postId: string, commentCap: number): Promise<void> => {
            await redis.set(getCommentCapKey(postId), JSON.stringify(commentCap), {
                expiration: addDays(new Date(), COMMENT_CAP_TTL_DAYS),
            });
        },
        forgetCommentCap: async (postId: string): Promise<void> => {
            await redis.del(getCommentCapKey(postId));
        },
    };
}
