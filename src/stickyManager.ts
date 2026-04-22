import { JobContext, JSONObject, Post, ScheduledJobEvent, TriggerContext } from "@devvit/public-api";
import { Config, getConfig } from "./config.js";
import { addDays, addSeconds, format } from "date-fns";
import { ScheduledJob } from "./constants.js";
import { PostDelete } from "@devvit/protos";

const STICKY_POST_STORE = "StickyPostStore";

type RedisContext = Pick<TriggerContext, "redis">;
export type PostCreationContext = Pick<TriggerContext, "reddit" | "redis" | "subredditName">;

async function getPostIdForConfig (config: Config, context: TriggerContext): Promise<string | undefined> {
    return context.redis.hGet(STICKY_POST_STORE, config.name);
}

export function hasScheduledRefresh (config: Config): config is Config & {
    frequency: NonNullable<Config["frequency"]>;
    postTime: string;
} {
    return config.frequency != null && config.postTime != null;
}

async function deleteTrackedPosts (configNames: string[], context: RedisContext) {
    if (configNames.length === 0) {
        return;
    }

    const trackedPosts = await context.redis.hGetAll(STICKY_POST_STORE);
    const configNameSet = new Set(configNames);
    const postIds = Object.entries(trackedPosts)
        .filter(([configName]) => configNameSet.has(configName))
        .map(([, postId]) => postId);

    await context.redis.hDel(STICKY_POST_STORE, configNames);
    for (const postId of postIds) {
        await context.redis.del(getCommentCapKey(postId));
    }
}

export async function refreshStickyPosts (_: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    let config = await getConfig(context);
    if (config.length === 0) {
        console.log("No sticky post configurations found.");
        const trackedConfigNames = Object.keys(await context.redis.hGetAll(STICKY_POST_STORE));
        await deleteTrackedPosts(trackedConfigNames, context);
        return;
    }

    // Sort posts with sticky ones first.
    config = config.filter(item => item.enabled).sort((a, b) => {
        if (a.sticky && !b.sticky) {
            return -1; // a comes first
        }
        if (!a.sticky && b.sticky) {
            return 1; // b comes first
        }
        return 0; // maintain original order for others
    });

    for (const configEntry of config) {
        await refreshPost(configEntry, context);
    }

    await scheduleNextRefresh(context);

    const configsWithTrackedPosts = await context.redis.hKeys(STICKY_POST_STORE);
    const keysWithoutExistingConfigs = configsWithTrackedPosts.filter(key => !config.some(item => item.name === key));
    if (keysWithoutExistingConfigs.length > 0) {
        console.log(`Removing stale sticky post configurations: ${keysWithoutExistingConfigs.join(", ")}`);
        await deleteTrackedPosts(keysWithoutExistingConfigs, context);
    }
}

export function getRefreshTime (postDate: Date, config: Config): Date | undefined {
    if (!hasScheduledRefresh(config)) {
        return undefined;
    }

    const [hoursString, minutesString] = config.postTime.split(":");
    const hours = Number.parseInt(hoursString, 10);
    const minutes = Number.parseInt(minutesString, 10);

    const createUtcDateAtTime = (dayOffset: number) => new Date(Date.UTC(
        postDate.getUTCFullYear(),
        postDate.getUTCMonth(),
        postDate.getUTCDate() + dayOffset,
        hours,
        minutes,
    ));

    if (config.frequency === "daily") {
        const nextPostTime = createUtcDateAtTime(0);
        if (nextPostTime.getTime() < postDate.getTime() + 6 * 60 * 60 * 1000) {
            return createUtcDateAtTime(1);
        }

        return nextPostTime;
    } else {
        const targetDay = ["sundays", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays"].indexOf(config.frequency);
        const currentDay = postDate.getUTCDay();
        let dayOffset = (targetDay - currentDay + 7) % 7;

        if (dayOffset === 0) {
            dayOffset = 7;
        }

        return createUtcDateAtTime(dayOffset);
    }
}

async function refreshPost (config: Config, context: TriggerContext) {
    const postId = await getPostIdForConfig(config, context);
    if (postId) {
        const post = await context.reddit.getPostById(postId);
        const refreshTime = getRefreshTime(post.createdAt, config);
        if ((refreshTime != null && refreshTime < new Date()) || post.numberOfComments >= config.maxComments) {
            await createPost(post, config, context);
            return;
        }

        if (post.body?.trim() !== config.body.trim()) {
            console.log(`Updating post for config ${config.name} as body has changed.`);
            await post.edit({
                text: config.body,
            });
        }

        await storeCommentCap(post.id, config, context);
    } else {
        await createPost(undefined, config, context);
    }
}

function getCommentCapKey (postId: string) {
    return `CommentCap:${postId}`;
}

async function storeCommentCap (postId: string, config: Config, context: RedisContext) {
    await context.redis.set(getCommentCapKey(postId), JSON.stringify(config.maxComments), { expiration: addDays(new Date(), 28) });
}

export async function getCommentCap (postId: string, context: TriggerContext): Promise<number | undefined> {
    const cap = await context.redis.get(getCommentCapKey(postId));
    if (cap) {
        return JSON.parse(cap) as number;
    }
}

function getPostTitle (config: Config): string {
    const title = config.title;
    const dateRegex = /{{date (.+)}}/;
    const matches = dateRegex.exec(title);
    if (!matches) {
        return title;
    }

    return title.replace(matches[0], format(new Date(), matches[1]));
}

export async function createPost (existingPost: Post | undefined, config: Config, context: PostCreationContext) {
    if (existingPost) {
        if (existingPost.stickied) {
            await existingPost.unsticky();
        }
        if (config.endNote) {
            const newComment = await existingPost.addComment({ text: config.endNote });
            await newComment.distinguish(true);
        }

        if (config.lockOnRefresh) {
            await existingPost.lock();
        }
    }

    const newPost = await context.reddit.submitPost({
        title: getPostTitle(config),
        text: config.body,
        subredditName: context.subredditName ?? await context.reddit.getCurrentSubredditName(),
    });

    await newPost.distinguish();
    if (config.sticky) {
        await newPost.sticky(); // config.stickyPosition;
    }

    await context.redis.hSet(STICKY_POST_STORE, { [config.name]: newPost.id });
    await storeCommentCap(newPost.id, config, context);
    console.log(`Created new post for config ${config.name} with ID ${newPost.id}.`);
}

export async function refreshPostFromPostId (postId: string, context: TriggerContext) {
    const trackedPostData = await context.redis.hGetAll(STICKY_POST_STORE);
    const trackedPosts = Object.entries(trackedPostData).map(([name, id]) => ({ name, id }));
    const configName = trackedPosts.find(post => post.id === postId)?.name;
    if (!configName) {
        return;
    }

    const config = await getConfig(context);
    const configEntry = config.find(item => item.name === configName);
    if (configEntry) {
        await refreshPost(configEntry, context);
        await scheduleNextRefresh(context);
    }
}

export async function scheduleNextRefresh (context: TriggerContext) {
    // Clear down any scheduled jobs for refreshing sticky posts
    const existingJobs = await context.scheduler.listJobs();
    for (const job of existingJobs.filter(job => job.name === ScheduledJob.RefreshStickyPosts as string)) {
        await context.scheduler.cancelJob(job.id);
    }

    const config = await getConfig(context);
    const trackedPosts = await context.redis.hGetAll(STICKY_POST_STORE);

    let nextRefreshDue: Date | undefined;

    for (const configEntry of config) {
        if (!configEntry.enabled) {
            continue;
        }

        if (!hasScheduledRefresh(configEntry)) {
            continue;
        }

        const postId = trackedPosts[configEntry.name];
        if (postId) {
            const post = await context.reddit.getPostById(postId);
            const refreshTime = getRefreshTime(post.createdAt, configEntry);
            if (refreshTime && (!nextRefreshDue || refreshTime < nextRefreshDue)) {
                nextRefreshDue = refreshTime;
            }
        }
    }

    if (!nextRefreshDue) {
        console.log("No scheduled sticky post refreshes found.");
        return;
    }

    if (nextRefreshDue < new Date()) {
        nextRefreshDue = new Date();
    }

    await context.scheduler.runJob({
        name: ScheduledJob.RefreshStickyPosts,
        runAt: addSeconds(nextRefreshDue, 5),
    });

    console.log(`Scheduled next sticky post refresh at ${nextRefreshDue.toISOString()}.`);
}

export async function handlePostDelete (event: PostDelete, context: TriggerContext) {
    const trackedPosts = await context.redis.hGetAll(STICKY_POST_STORE);
    const trackedPost = Object.entries(trackedPosts)
        .map(([name, postId]) => ({ name, id: postId }))
        .find(entry => entry.id === event.postId);

    if (!trackedPost) {
        return;
    }

    await context.redis.hDel(STICKY_POST_STORE, [trackedPost.name]);
    await context.redis.del(getCommentCapKey(event.postId));
}
