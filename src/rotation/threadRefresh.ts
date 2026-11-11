import { getPin, getSchedule, renderEndNote, renderTitle } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { unpinPost } from "../highlights/index.js";
import { rotationSlot } from "./domain/pinRules.js";
import { findRotationReason } from "./domain/rotationRules.js";
import type { RotationReason } from "./domain/rotationRules.js";
import { placeLivePost } from "./livePostPins.js";
import type { Handover, ManagedComment, ManagedPost, RotationPorts } from "./ports.js";

/** What a refresh did for one thread config. */
export type ThreadOutcome = "published" | "resumed" | "rotated" | "skipped" | "unchanged" | "updated";

type PublishPorts = Pick<RotationPorts, "highlights" | "livePosts" | "notifyModerators" | "posts">;

/** One thread config's handover, and the ports that finishing it uses. */
interface HandoverContext {
    readonly config: ThreadConfig;
    readonly handover: Handover;
    readonly ports: PublishPorts;
}

/**
 * Distinguishes the new live post unless Reddit shows it done, and pins it in the handover's slot (for a handover
 * recorded before handovers kept a slot, the slot its thread config gives). Returns the new post as Reddit shows it.
 */
async function establishNewPost({ config, handover, ports }: HandoverContext): Promise<ManagedPost> {
    const post = await ports.posts.get(handover.newPostId);
    if (post.distinguishedBy === undefined) {
        await post.distinguish();
    }

    const slot = handover.slot ?? rotationSlot(getPin(config), undefined);
    if (slot !== undefined) {
        await placeLivePost({ config, post, slot }, ports);
    }

    await ports.livePosts.storeCommentCap(post.id, config.maxComments);
    return post;
}

/** The old post's end note: the one recorded in the handover, or a new one, recorded before it is distinguished. */
async function getEndNote(post: ManagedPost, endNote: string, context: HandoverContext): Promise<ManagedComment> {
    const { config, handover, ports } = context;
    if (handover.endNoteId !== undefined) {
        return await ports.posts.getComment(handover.endNoteId);
    }

    const comment = await post.addComment({ text: endNote });
    // Recorded before anything else can fail, so finishing again distinguishes this comment rather than adding another.
    await ports.livePosts.saveHandover(config.name, { ...handover, endNoteId: comment.id });
    return comment;
}

/**
 * Gives the old post its end note, linking `newPost` where it asks, and its lock, as its thread config asks, and
 * forgets its comment cap.
 */
async function retireOldPost(postId: string, newPost: ManagedPost, context: HandoverContext): Promise<void> {
    const { config, ports } = context;
    const post = await ports.posts.get(postId);
    if (config.endNote != null && config.endNote !== "") {
        const endNote = await getEndNote(post, renderEndNote(config.endNote, newPost), context);
        await endNote.distinguish(true);
    }

    if (config.lockOnRefresh === true && !post.locked) {
        await post.lock();
    }

    // Only a live post's comment cap starts a rotation; a retired post's would cost a lookup per comment.
    await ports.livePosts.forgetCommentCap(post.id);
    console.log(`Retired live post ${post.id} of thread config ${config.name}.`);
}

/**
 * Finishes a handover: records the new post as live, distinguishes and pins it, retires the old post, then
 * forgets the handover. Each step checks what Reddit shows, or what the handover records, before acting, so finishing
 * again after a failure repeats none of them; the handover stays recorded until all of them are done.
 */
async function finishHandover(context: HandoverContext): Promise<void> {
    const { config, handover, ports } = context;
    // Again on a retry, in case the rotation stopped between recording the handover and the live post.
    await ports.livePosts.set(config.name, handover.newPostId);
    const newPost = await establishNewPost(context);
    if (handover.oldPostId !== undefined) {
        await retireOldPost(handover.oldPostId, newPost, context);
    }

    await ports.livePosts.forgetHandover(config.name);
}

/** Unpins the retiring live post if it is pinned, wherever it sits; the slot it had. */
async function unpinRetiringPost(
    post: ManagedPost,
    config: ThreadConfig,
    ports: PublishPorts,
): Promise<number | undefined> {
    const slot = await unpinPost(post.id, ports.highlights);
    if (slot !== undefined) {
        console.log(
            `Unpinned retiring live post ${post.id} of thread config ${config.name} from slot ${String(slot)}.`,
        );
    }

    return slot;
}

/**
 * Publishes a new live post for the thread config, retiring the previous one if there is one. The old post first
 * gives up its slot, so pinning the replacement needs no seventh highlight; the replacement is published, and the
 * handover that remains, with the slot the replacement takes, is recorded before any of it starts, so a refresh after a
 * failure finishes it.
 */
export async function rotateLivePost(
    previousPost: ManagedPost | undefined,
    config: ThreadConfig,
    ports: PublishPorts,
): Promise<void> {
    const oldSlot = previousPost === undefined ? undefined : await unpinRetiringPost(previousPost, config, ports);
    const newPost = await ports.posts.publish({ title: renderTitle(config.title, new Date()), body: config.body });
    const slot = rotationSlot(getPin(config), oldSlot);
    const handover: Handover = {
        newPostId: newPost.id,
        ...(previousPost === undefined ? {} : { oldPostId: previousPost.id }),
        ...(slot === undefined ? {} : { slot }),
    };
    await ports.livePosts.saveHandover(config.name, handover);
    console.log(`Published live post ${newPost.id} for thread config ${config.name}.`);
    await finishHandover({ config, handover, ports });
}

function describeRotationReason(reason: RotationReason): string {
    return reason.kind === "comment cap"
        ? `which has reached its comment cap of ${String(reason.commentCap)}`
        : `whose rotation time ${reason.rotationTime.toISOString()} has passed`;
}

/** Brings a live post that is not due up to date: its body, and its comment cap, renewed. */
async function updateLivePost(post: ManagedPost, config: ThreadConfig, ports: PublishPorts): Promise<ThreadOutcome> {
    const bodyChanged = post.body?.trim() !== config.body.trim();
    if (bodyChanged) {
        console.log(`Updating the body of live post ${post.id} for thread config ${config.name}.`);
        await post.edit({ text: config.body });
    }

    await ports.livePosts.storeCommentCap(post.id, config.maxComments);
    return bodyChanged ? "updated" : "unchanged";
}

/** Rotates a live post that is due, logging why; otherwise brings it up to date. */
async function refreshLivePost(post: ManagedPost, config: ThreadConfig, ports: PublishPorts): Promise<ThreadOutcome> {
    const rotatesOn = { schedule: getSchedule(config), commentCap: config.maxComments };
    const reason = findRotationReason(post, rotatesOn, Date.now());
    if (reason === undefined) {
        return await updateLivePost(post, config, ports);
    }

    console.log(
        `Rotating thread config ${config.name}: replacing live post ${post.id}, ${describeRotationReason(reason)}.`,
    );
    await rotateLivePost(post, config, ports);
    return "rotated";
}

/** Finishes the thread config's handover if a rotation left one unfinished; true when there was one. */
async function resumeHandover(config: ThreadConfig, ports: PublishPorts): Promise<boolean> {
    const handover = (await ports.livePosts.handovers())[config.name];
    if (handover === undefined) {
        return false;
    }

    console.log(`Finishing the handover of thread config ${config.name} to live post ${handover.newPostId}.`);
    await finishHandover({ config, handover, ports });
    return true;
}

async function refreshUnlocked(config: ThreadConfig, ports: PublishPorts): Promise<ThreadOutcome> {
    const resumed = await resumeHandover(config, ports);
    const postId = await ports.livePosts.get(config.name);
    if (postId === undefined) {
        await rotateLivePost(undefined, config, ports);
        return "published";
    }

    const outcome = await refreshLivePost(await ports.posts.get(postId), config, ports);
    return resumed && outcome === "unchanged" ? "resumed" : outcome;
}

/**
 * Refreshes a thread config whose lock this invocation holds, releasing the lock if the refresh fails. A failure to
 * release it then is logged rather than thrown, so the refresh's own failure is the one reported; the lock expires on
 * its own.
 */
async function refreshHoldingLock(
    config: ThreadConfig,
    ports: PublishPorts & Pick<RotationPorts, "threadLocks">,
): Promise<ThreadOutcome> {
    try {
        return await refreshUnlocked(config, ports);
    } catch (error: unknown) {
        await ports.threadLocks.unlock(config.name).catch((unlockError: unknown): void => {
            console.error(
                `Could not release the lock on thread config ${config.name} after its refresh failed; the lock expires on its own:`,
                unlockError,
            );
        });
        throw error;
    }
}

/**
 * Publishes, rotates or updates one thread config's live post, holding the thread config's lock so no other
 * invocation does the same at once. Reads the live post only once it holds the lock, so it acts on the state the last
 * holder left, and first finishes any handover a failed rotation left unfinished. Skips the thread config while
 * another invocation holds its lock.
 */
export async function refreshThread(
    config: ThreadConfig,
    ports: PublishPorts & Pick<RotationPorts, "threadLocks">,
): Promise<ThreadOutcome> {
    if (!(await ports.threadLocks.tryLock(config.name))) {
        console.log(`Skipping thread config ${config.name}: another refresh of it is under way.`);
        return "skipped";
    }

    const outcome = await refreshHoldingLock(config, ports);
    await ports.threadLocks.unlock(config.name);
    return outcome;
}
