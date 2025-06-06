import { JobContext, JSONObject, Post, ScheduledJobEvent, TriggerContext } from "@devvit/public-api";
import { Config, getConfig } from "./config.js";
import { addDays, addHours, addSeconds, Day, format, nextDay, startOfDay } from "date-fns";
import { ScheduledJob } from "./constants.js";
import { PostDelete } from "@devvit/protos";

const STICKY_POST_STORE = "StickyPostStore";

async function getPostIdForConfig (config: Config, context: TriggerContext): Promise<string | undefined> {
    return context.redis.hGet(STICKY_POST_STORE, config.name);
}

export async function refreshStickyPosts (_: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    let config = await getConfig(context);
    if (config.length === 0) {
        console.log("No sticky post configurations found.");
        return;
    }

    // Sort posts by sticky position, with undefined positions at the end
    config = config.filter(item => item.enabled).sort((a, b) => {
        if (a.stickyPosition === b.stickyPosition) {
            return 0;
        }
        if (a.stickyPosition === undefined) {
            return 1;
        };
        if (b.stickyPosition === undefined) {
            return -1;
        }
        return (a.stickyPosition ?? 0) - (b.stickyPosition ?? 0);
    });

    for (const configEntry of config) {
        await refreshPost(configEntry, context);
    }

    await scheduleNextRefresh(context);

    const configsWithTrackedPosts = await context.redis.hKeys(STICKY_POST_STORE);
    const keysWithoutExistingConfigs = configsWithTrackedPosts.filter(key => !config.some(item => item.name === key));
    if (keysWithoutExistingConfigs.length > 0) {
        console.log(`Removing stale sticky post configurations: ${keysWithoutExistingConfigs.join(", ")}`);
        await context.redis.hDel(STICKY_POST_STORE, keysWithoutExistingConfigs);
    }
}

export function getRefreshTime (postDate: Date, config: Config): Date {
    const hours = parseInt(config.postTime.split(":")[0]);
    if (config.frequency === "daily") {
        const nextPostTime = addHours(startOfDay(postDate), hours);
        if (nextPostTime < addHours(postDate, 6)) {
            return addDays(nextPostTime, 1);
        } else {
            return nextPostTime;
        }
    } else {
        const targetDay = ["sundays", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays"].indexOf(config.frequency) as Day;
        const startOfNextDay = startOfDay(nextDay(postDate, targetDay));
        const nextPostTime = addHours(startOfNextDay, hours);
        return nextPostTime;
    }
}

async function refreshPost (config: Config, context: TriggerContext) {
    const postId = await getPostIdForConfig(config, context);
    if (postId) {
        const post = await context.reddit.getPostById(postId);
        const refreshTime = getRefreshTime(post.createdAt, config);
        if (refreshTime < new Date() || post.numberOfComments >= config.maxComments) {
            await createPost(post, config, context);
        } else if (post.body?.trim() !== config.body.trim()) {
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

async function storeCommentCap (postId: string, config: Config, context: TriggerContext) {
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

async function createPost (existingPost: Post | undefined, config: Config, context: TriggerContext) {
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
    if (config.stickyPosition) {
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
        const postId = trackedPosts[configEntry.name];
        if (postId) {
            const post = await context.reddit.getPostById(postId);
            const refreshTime = getRefreshTime(post.createdAt, configEntry);
            if (!nextRefreshDue || refreshTime < nextRefreshDue) {
                nextRefreshDue = refreshTime;
            }
        }
    }

    if (!nextRefreshDue) {
        console.log("No sticky posts found to refresh.");
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
