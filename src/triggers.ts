import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import type { ConfigPageInstallContext, ConfigPageRevisionContext } from "./configuration/index.js";
import {
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
} from "./rotation/index.js";
import type { LivePostCleanupContext, RefreshJobContext, RotationContext } from "./rotation/index.js";

// Each handler adapts one Devvit trigger or scheduled job to the modules' interfaces. Trigger events are protobuf
// messages, whose string fields default to "", so an empty string means the field is missing.

export type ModActionEvent = Readonly<{
    action?: string | undefined;
    moderator?: Readonly<{ name: string }> | undefined;
}>;

export type CommentCreateEvent = Readonly<{
    author?: Readonly<{ name: string }> | undefined;
    post?: Readonly<{ id: string }> | undefined;
}>;

function getRevisingModerator(event: ModActionEvent): string | undefined {
    if (event.action !== "wikirevise") {
        return undefined;
    }

    const moderatorName = event.moderator?.name ?? "";
    if (moderatorName === "") {
        console.error("Moderator name is missing in the event.");
        return undefined;
    }

    return moderatorName;
}

/** A wiki page was revised: newly stored thread configs are applied by a refresh shortly afterwards. */
export async function onModAction(
    event: ModActionEvent,
    context: ConfigPageRevisionContext & RefreshJobContext,
): Promise<void> {
    const moderatorName = getRevisingModerator(event);
    if (moderatorName === undefined) {
        return;
    }

    if ((await applyConfigPageRevision(moderatorName, context)) === "stored") {
        await requestRefresh(context);
    }
}

/** The commented post's ID, or undefined when the comment cannot count towards a comment cap. */
function getCountedPostId(event: CommentCreateEvent, appSlug: string): string | undefined {
    const postId = event.post?.id ?? "";
    if (postId === "") {
        console.error("CommentCreate event does not contain a post ID.");
        return undefined;
    }

    // The app's own comments (end notes on retiring live posts) never count towards a comment cap.
    return event.author?.name === appSlug ? undefined : postId;
}

export async function onCommentCreate(
    event: CommentCreateEvent,
    context: RotationContext & Readonly<{ appSlug: string }>,
): Promise<void> {
    const postId = getCountedPostId(event, context.appSlug);
    if (postId !== undefined) {
        await rotateIfCapReached(postId, context);
    }
}

export async function onPostDelete(
    event: Readonly<{ postId: string }>,
    context: LivePostCleanupContext,
): Promise<void> {
    await forgetDeletedPost(event.postId, context);
}

export async function onAppInstall(_event: unknown, context: ConfigPageInstallContext): Promise<void> {
    await installConfigPage(context);
}

export async function onAppUpgrade(_event: unknown, context: RotationContext): Promise<void> {
    await scheduleNextRefresh(context);
}

export async function onRefreshJob(_event: unknown, context: RotationContext): Promise<void> {
    await refreshAllThreads(context);
}
