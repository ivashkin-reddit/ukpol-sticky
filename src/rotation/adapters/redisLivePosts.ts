import { addDays } from "date-fns";
import type { RedisPort } from "../../platform/index.js";
import type { Handover, LivePosts } from "../ports.js";

// Live state in every installed subreddit, so these keys stay stable: thread config name -> ID of its live post,
// thread config name -> its unfinished handover (as JSON), and each live post's comment cap.
const STICKY_POST_STORE = "StickyPostStore";
const PENDING_HANDOVERS = "PendingHandovers";
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

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function isHandover(value: unknown): value is Handover {
    return (
        typeof value === "object" &&
        value !== null &&
        "newPostId" in value &&
        typeof value.newPostId === "string" &&
        isOptionalString("oldPostId" in value ? value.oldPostId : undefined) &&
        isOptionalString("endNoteId" in value ? value.endNoteId : undefined)
    );
}

function parseHandover(configName: string, stored: string): Handover {
    const handover: unknown = JSON.parse(stored);
    if (!isHandover(handover)) {
        throw new TypeError(`The stored handover of thread config ${configName} is not a handover: ${stored}`);
    }

    return handover;
}

async function readHandovers(redis: LivePostsRedis): Promise<Readonly<Record<string, Handover>>> {
    const stored = await redis.hGetAll(PENDING_HANDOVERS);
    return Object.fromEntries(
        Object.entries(stored).map(([configName, value]: readonly [string, string]): [string, Handover] => [
            configName,
            parseHandover(configName, value),
        ]),
    );
}

async function readConfigNames(redis: LivePostsRedis): Promise<readonly string[]> {
    const [withLivePost, withHandover] = await Promise.all([
        redis.hKeys(STICKY_POST_STORE),
        redis.hKeys(PENDING_HANDOVERS),
    ]);
    return [...new Set([...withLivePost, ...withHandover])];
}

async function forget(
    redis: LivePostsRedis,
    configNames: readonly string[],
    postIds: readonly string[],
): Promise<void> {
    await redis.hDel(STICKY_POST_STORE, [...configNames]);
    await redis.hDel(PENDING_HANDOVERS, [...configNames]);
    if (postIds.length > 0) {
        await redis.del(...postIds.map((postId): string => getCommentCapKey(postId)));
    }
}

/**
 * Live posts in the subreddit's Redis: one hash of live post IDs, one of unfinished handovers, and an expiring key
 * per comment cap.
 */
export function redisLivePosts(redis: LivePostsRedis): LivePosts {
    return {
        all: async (): Promise<Readonly<Record<string, string>>> => await redis.hGetAll(STICKY_POST_STORE),
        get: async (configName: string): Promise<string | undefined> => await redis.hGet(STICKY_POST_STORE, configName),
        configNames: async (): Promise<readonly string[]> => await readConfigNames(redis),
        set: async (configName: string, postId: string): Promise<void> => {
            await redis.hSet(STICKY_POST_STORE, { [configName]: postId });
        },
        forget: async (configNames: readonly string[], postIds: readonly string[]): Promise<void> => {
            await forget(redis, configNames, postIds);
        },
        handovers: async (): Promise<Readonly<Record<string, Handover>>> => await readHandovers(redis),
        saveHandover: async (configName: string, handover: Handover): Promise<void> => {
            await redis.hSet(PENDING_HANDOVERS, { [configName]: JSON.stringify(handover) });
        },
        forgetHandover: async (configName: string): Promise<void> => {
            await redis.hDel(PENDING_HANDOVERS, [configName]);
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
