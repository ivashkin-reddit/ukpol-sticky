import { getSchedule, renderTitle } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { isDueForRotation } from "./domain/rotationRules.js";
import type { LivePosts, ManagedPost, RotationPorts } from "./ports.js";

/** What a refresh did for one thread config. */
export type ThreadOutcome = "published" | "rotated" | "skipped" | "unchanged" | "updated";

type PublishPorts = Pick<RotationPorts, "livePosts" | "posts">;

/** Publishes a replacement and records it as the thread config's live post, then distinguishes and stickies it. */
async function publishLivePost(config: ThreadConfig, ports: PublishPorts): Promise<ManagedPost> {
    const newPost = await ports.posts.publish({ title: renderTitle(config.title, new Date()), body: config.body });
    // Recorded before anything else can fail, so a retry finds this post rather than publishing a second one.
    await ports.livePosts.set(config.name, newPost.id);
    await newPost.distinguish();
    if (config.sticky === true) {
        await newPost.sticky();
    }

    await ports.livePosts.storeCommentCap(newPost.id, config.maxComments);
    console.log(`Published live post ${newPost.id} for thread config ${config.name}.`);
    return newPost;
}

/** Gives the outgoing live post its end note and lock, as its thread config asks, and forgets its comment cap. */
async function retireLivePost(post: ManagedPost, config: ThreadConfig, livePosts: LivePosts): Promise<void> {
    if (config.endNote != null && config.endNote !== "") {
        const comment = await post.addComment({ text: config.endNote });
        await comment.distinguish(true);
    }

    if (config.lockOnRefresh === true) {
        await post.lock();
    }

    // Only a live post's comment cap starts a rotation; a retired post's would cost a lookup per comment.
    await livePosts.forgetCommentCap(post.id);
    console.log(`Retired live post ${post.id} of thread config ${config.name}.`);
}

/**
 * Publishes a new live post for the thread config, retiring the previous one if there is one. The steps run in an
 * order that lets a retry after any failure finish the job without repeating a side effect: the old post first gives
 * up its sticky slot (a subreddit has two, and the replacement may need one); the replacement is published and
 * recorded; only then is the old post retired. A failure after the replacement is recorded leaves the remaining
 * steps undone, and the moderator alert names the thread config.
 */
export async function rotateLivePost(
    previousPost: ManagedPost | undefined,
    config: ThreadConfig,
    ports: PublishPorts,
): Promise<void> {
    if (previousPost !== undefined) {
        console.log(`Rotating thread config ${config.name}: replacing live post ${previousPost.id}.`);
    }

    if (previousPost?.stickied === true) {
        await previousPost.unsticky();
    }

    await publishLivePost(config, ports);
    if (previousPost !== undefined) {
        await retireLivePost(previousPost, config, ports.livePosts);
    }
}

/** Rotates a live post that is due; otherwise brings its body up to date and renews its comment cap. */
async function refreshLivePost(post: ManagedPost, config: ThreadConfig, ports: PublishPorts): Promise<ThreadOutcome> {
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

async function refreshUnlocked(config: ThreadConfig, ports: PublishPorts): Promise<ThreadOutcome> {
    const postId = await ports.livePosts.get(config.name);
    if (postId === undefined) {
        await rotateLivePost(undefined, config, ports);
        return "published";
    }

    return await refreshLivePost(await ports.posts.get(postId), config, ports);
}

/**
 * Publishes, rotates or updates one thread config's live post, holding the thread config's lock so no other
 * invocation does the same at once. Reads the live post only once it holds the lock, so it acts on the state the last
 * holder left. Skips the thread config while another invocation holds its lock.
 */
export async function refreshThread(
    config: ThreadConfig,
    ports: PublishPorts & Pick<RotationPorts, "threadLocks">,
): Promise<ThreadOutcome> {
    if (!(await ports.threadLocks.tryLock(config.name))) {
        console.log(`Skipping thread config ${config.name}: another refresh of it is under way.`);
        return "skipped";
    }

    try {
        return await refreshUnlocked(config, ports);
    } finally {
        await ports.threadLocks.unlock(config.name);
    }
}
