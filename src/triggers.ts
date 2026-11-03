import { configurationPorts, rotationPorts } from "./composition.js";
import type { ConfigurationContext, RotationContext } from "./composition.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import {
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
} from "./rotation/index.js";

// Each handler adapts one Devvit trigger or scheduled job to a module's use case, with ports from src/composition.ts.
// Trigger events are protobuf messages, whose string fields default to "", so an empty string means the field is
// missing.

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
    context: ConfigurationContext & RotationContext,
): Promise<void> {
    const moderatorName = getRevisingModerator(event);
    if (moderatorName === undefined) {
        return;
    }

    if ((await applyConfigPageRevision(moderatorName, configurationPorts(context))) === "stored") {
        await requestRefresh(rotationPorts(context).refreshJobs);
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
        await rotateIfCapReached(postId, rotationPorts(context));
    }
}

export async function onPostDelete(event: Readonly<{ postId: string }>, context: RotationContext): Promise<void> {
    await forgetDeletedPost(event.postId, rotationPorts(context).livePosts);
}

export async function onAppInstall(_event: unknown, context: ConfigurationContext): Promise<void> {
    await installConfigPage(configurationPorts(context).page);
}

export async function onAppUpgrade(_event: unknown, context: RotationContext): Promise<void> {
    await scheduleNextRefresh(rotationPorts(context));
}

export async function onRefreshJob(_event: unknown, context: RotationContext): Promise<void> {
    await refreshAllThreads(rotationPorts(context));
}
