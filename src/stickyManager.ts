import { JobContext, JSONObject, Post, ScheduledJobEvent, TriggerContext } from "@devvit/public-api";
import { Config, getConfig } from "./config.js";
import { addDays, addHours, Day, format, nextDay, startOfDay } from "date-fns";

const STICKY_POST_STORE = "StickyPostStore";

async function getPostIdForConfig (config: Config, context: TriggerContext): Promise<string | undefined> {
    return context.redis.hGet(STICKY_POST_STORE, config.name);
}

export async function refreshStickyPosts (event: ScheduledJobEvent<JSONObject | undefined>, context: JobContext) {
    const config = await getConfig(context);
    if (config.length === 0) {
        console.log("No sticky post configurations found.");
        return;
    }

    // Sort posts by sticky position, with undefined positions at the end
    config.filter(item => item.enabled).sort((a, b) => {
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
}

export function getRefreshTime (postDate: Date, config: Config): Date {
    const hours = parseInt(config.postTime.split(":")[0]);
    let nextPostDay: Date;

    if (config.frequency === "daily") {
        nextPostDay = addDays(startOfDay(postDate), 1);
    } else {
        const targetDay = ["sundays", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays"].indexOf(config.frequency);
        nextPostDay = nextDay(postDate, targetDay as Day);
        return addHours(startOfDay(nextPostDay), hours);
    }

    return addHours(startOfDay(nextPostDay), hours);
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
        await existingPost.unsticky();
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
        await newPost.sticky(config.stickyPosition);
    }

    await context.redis.hSet(STICKY_POST_STORE, { [config.name]: newPost.id });
    await storeCommentCap(newPost.id, config, context);
    console.log(`Created new sticky post for config ${config.name} with ID ${newPost.id}.`);
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
    }
}
