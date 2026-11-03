import { addDays, addHours, addSeconds } from "date-fns";
import { getConfig, parsePostTime, WEEKLY_FREQUENCIES } from "./config.js";
import type { Config, ConfigReadContext, ScheduleFrequency } from "./config.js";
import { getSubredditName } from "./ports.js";
import type { RedisPort, SubredditNamePort } from "./ports.js";
import { cancelRefreshJobs, scheduleRefresh } from "./refreshJob.js";
import type { RefreshJobContext } from "./refreshJob.js";
import { renderTitle } from "./titleTemplate.js";

const STICKY_POST_STORE = "StickyPostStore";
const COMMENT_CAP_TTL_DAYS = 28;
const REFRESH_JOB_DELAY_SECONDS = 5;
// A daily post created less than this many hours before today's post time runs until tomorrow's.
const MIN_HOURS_BEFORE_DAILY_REFRESH = 6;
const DAYS_PER_WEEK = 7;

export interface ManagedComment {
    readonly distinguish: (makeSticky?: boolean) => Promise<void>;
}

/** The parts of a Devvit Post this app reads and calls. */
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

type TrackedPostContext = Readonly<{ redis: RedisPort<"del" | "hDel" | "hGetAll"> }>;

export type CreatePostContext = SubredditNamePort & Readonly<{
    redis: RedisPort<"hSet" | "set">;
    reddit: Readonly<{
        submitPost: (options: Readonly<{ subredditName: string; text: string; title: string }>) => Promise<ManagedPost>;
    }>;
}>;

export type StickyContext = ConfigReadContext & CreatePostContext & RefreshJobContext & TrackedPostContext & Readonly<{
    redis: RedisPort<"get" | "hGet" | "hKeys">;
    reddit: Readonly<{ getPostById: (id: string) => Promise<ManagedPost> }>;
}>;

function getCommentCapKey (postId: string): string {
    return `CommentCap:${postId}`;
}

function findTrackedConfigName (trackedPosts: Readonly<Record<string, string>>, postId: string): string | undefined {
    return Object.entries(trackedPosts).find(([, trackedPostId]: readonly [string, string]): boolean => trackedPostId === postId)?.[0];
}

export function hasScheduledRefresh (config: Config): config is Config & Readonly<{ frequency: ScheduleFrequency; postTime: string }> {
    return config.frequency !== undefined && config.postTime != null;
}

export function getRefreshTime (postDate: Date, config: Config): Date | undefined {
    if (!hasScheduledRefresh(config)) {
        return undefined;
    }

    const { hours, minutes } = parsePostTime(config.postTime);
    const atPostTime = (dayOffset: number): Date => new Date(Date.UTC(
        postDate.getUTCFullYear(),
        postDate.getUTCMonth(),
        postDate.getUTCDate() + dayOffset,
        hours,
        minutes,
    ));

    if (config.frequency === "daily") {
        const sameDay = atPostTime(0);
        return sameDay.getTime() < addHours(postDate, MIN_HOURS_BEFORE_DAILY_REFRESH).getTime() ? atPostTime(1) : sameDay;
    }

    const daysUntil = (WEEKLY_FREQUENCIES.indexOf(config.frequency) - postDate.getUTCDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    // A weekly post created on its own weekday runs until that weekday next week.
    return atPostTime(daysUntil === 0 ? DAYS_PER_WEEK : daysUntil);
}

async function storeCommentCap (postId: string, config: Config, context: Readonly<{ redis: RedisPort<"set"> }>): Promise<void> {
    await context.redis.set(getCommentCapKey(postId), JSON.stringify(config.maxComments), {
        expiration: addDays(new Date(), COMMENT_CAP_TTL_DAYS),
    });
}

export async function getCommentCap (postId: string, context: Readonly<{ redis: RedisPort<"get"> }>): Promise<number | undefined> {
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

async function deleteTrackedPosts (configNames: readonly string[], context: TrackedPostContext): Promise<void> {
    if (configNames.length === 0) {
        return;
    }

    const trackedPosts = await context.redis.hGetAll(STICKY_POST_STORE);
    const commentCapKeys = configNames.flatMap((configName): string[] => {
        const postId = trackedPosts[configName];
        return postId === undefined ? [] : [getCommentCapKey(postId)];
    });

    await context.redis.hDel(STICKY_POST_STORE, [...configNames]);
    if (commentCapKeys.length > 0) {
        await context.redis.del(...commentCapKeys);
    }
}

async function retirePost (post: ManagedPost, config: Config): Promise<void> {
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

export async function createPost (existingPost: ManagedPost | undefined, config: Config, context: CreatePostContext): Promise<void> {
    if (existingPost !== undefined) {
        await retirePost(existingPost, config);
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

    await context.redis.hSet(STICKY_POST_STORE, { [config.name]: newPost.id });
    await storeCommentCap(newPost.id, config, context);
    console.log(`Created new post for config ${config.name} with ID ${newPost.id}.`);
}

function isDueForRefresh (post: ManagedPost, config: Config): boolean {
    const refreshTime = getRefreshTime(post.createdAt, config);
    return (refreshTime !== undefined && refreshTime.getTime() < Date.now()) || post.numberOfComments >= config.maxComments;
}

async function refreshTrackedPost (post: ManagedPost, config: Config, context: StickyContext): Promise<void> {
    if (isDueForRefresh(post, config)) {
        await createPost(post, config, context);
        return;
    }

    if (post.body?.trim() !== config.body.trim()) {
        console.log(`Updating post for config ${config.name} as body has changed.`);
        await post.edit({ text: config.body });
    }

    await storeCommentCap(post.id, config, context);
}

async function refreshPost (config: Config, context: StickyContext): Promise<void> {
    const postId = await context.redis.hGet(STICKY_POST_STORE, config.name);
    if (postId === undefined) {
        await createPost(undefined, config, context);
        return;
    }

    await refreshTrackedPost(await context.reddit.getPostById(postId), config, context);
}

// Sticky posts take Reddit's sticky slots in the order they are stickied, and each refresh unstickies the old post
// before stickying its replacement, so configs refresh one at a time, in order.
async function refreshInOrder (configs: readonly Config[], context: StickyContext): Promise<void> {
    const [first, ...rest] = configs;
    if (first === undefined) {
        return;
    }

    await refreshPost(first, context);
    await refreshInOrder(rest, context);
}

function earliest (dates: readonly (Date | undefined)[]): Date | undefined {
    return dates
        .filter((date): date is Date => date !== undefined)
        .sort((first, second): number => first.getTime() - second.getTime())[0];
}

async function findNextRefreshTime (context: StickyContext): Promise<Date | undefined> {
    const configs = (await getConfig(context)).filter((config): boolean => config.enabled && hasScheduledRefresh(config));
    const trackedPosts = await context.redis.hGetAll(STICKY_POST_STORE);
    const refreshTimes = await Promise.all(configs.map(async (config): Promise<Date | undefined> => {
        const postId = trackedPosts[config.name];
        if (postId === undefined) {
            return undefined;
        }

        const post = await context.reddit.getPostById(postId);
        return getRefreshTime(post.createdAt, config);
    }));

    return earliest(refreshTimes);
}

export async function scheduleNextRefresh (context: StickyContext): Promise<void> {
    // Read everything first, so a config that cannot be read fails before any pending job is cancelled.
    const nextRefreshDue = await findNextRefreshTime(context);
    await cancelRefreshJobs(context);
    if (nextRefreshDue === undefined) {
        console.log("No scheduled sticky post refreshes found.");
        return;
    }

    const refreshAt = new Date(Math.max(nextRefreshDue.getTime(), Date.now()));
    await scheduleRefresh(context, addSeconds(refreshAt, REFRESH_JOB_DELAY_SECONDS));
    console.log(`Scheduled next sticky post refresh at ${refreshAt.toISOString()}.`);
}

// Sticky configs first; Array.prototype.sort is stable, so each group keeps its wiki page order.
function enabledStickyFirst (configs: readonly Config[]): readonly Config[] {
    return configs
        .filter((config): boolean => config.enabled)
        .sort((first, second): number => Number(second.sticky === true) - Number(first.sticky === true));
}

async function removeStaleTrackedPosts (activeConfigs: readonly Config[], context: StickyContext): Promise<void> {
    const trackedConfigNames = await context.redis.hKeys(STICKY_POST_STORE);
    const staleConfigNames = trackedConfigNames
        .filter((configName): boolean => !activeConfigs.some((config): boolean => config.name === configName));
    if (staleConfigNames.length > 0) {
        console.log(`Removing stale sticky post configurations: ${staleConfigNames.join(", ")}`);
        await deleteTrackedPosts(staleConfigNames, context);
    }
}

export async function refreshStickyPosts (_event: unknown, context: StickyContext): Promise<void> {
    const configs = await getConfig(context);
    if (configs.length === 0) {
        console.log("No sticky post configurations found.");
        await deleteTrackedPosts(Object.keys(await context.redis.hGetAll(STICKY_POST_STORE)), context);
        return;
    }

    const activeConfigs = enabledStickyFirst(configs);
    await refreshInOrder(activeConfigs, context);
    await scheduleNextRefresh(context);
    await removeStaleTrackedPosts(activeConfigs, context);
}

export async function refreshPostFromPostId (postId: string, context: StickyContext): Promise<void> {
    const configName = findTrackedConfigName(await context.redis.hGetAll(STICKY_POST_STORE), postId);
    if (configName === undefined) {
        return;
    }

    const config = (await getConfig(context)).find((candidate): boolean => candidate.name === configName);
    if (config === undefined) {
        return;
    }

    await refreshPost(config, context);
    await scheduleNextRefresh(context);
}

export async function handlePostDelete (event: Readonly<{ postId: string }>, context: TrackedPostContext): Promise<void> {
    const configName = findTrackedConfigName(await context.redis.hGetAll(STICKY_POST_STORE), event.postId);
    if (configName === undefined) {
        return;
    }

    await context.redis.hDel(STICKY_POST_STORE, [configName]);
    await context.redis.del(getCommentCapKey(event.postId));
}
