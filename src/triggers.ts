import { configurationPorts, rotationPorts } from "./composition.js";
import type { ConfigurationContext, RotationContext } from "./composition.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import {
    ensureRefreshPending,
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
    startRefreshCheck,
} from "./rotation/index.js";
import type { NewComment } from "./rotation/index.js";

// Each handler adapts one Devvit trigger or scheduled job to a module's use case, with ports from src/composition.ts.
// Trigger events are protobuf messages, whose string fields default to "" and number fields to 0, so an empty string or
// a 0 count means the field is missing.

export type ModActionEvent = Readonly<{
    action?: string | undefined;
    moderator?: Readonly<{ name: string }> | undefined;
}>;

export type CommentCreateEvent = Readonly<{
    author?: Readonly<{ name: string }> | undefined;
    post?: Readonly<{ id: string; numComments?: number | undefined }> | undefined;
}>;

function getRevisingModerator(event: ModActionEvent): string | undefined {
    if (event.action !== "wikirevise") {
        return undefined;
    }

    const moderatorName = event.moderator?.name ?? "";
    if (moderatorName === "") {
        console.warn("Ignoring a wiki revision ModAction event without a moderator name.");
        return undefined;
    }

    return moderatorName;
}

/**
 * Applies the config page's current revision if nothing has applied it yet, and requests a refresh if that stored
 * thread configs. `moderatorName` is whom a wiki revision event names, if one did.
 */
async function applyConfigPage(
    moderatorName: string | undefined,
    context: ConfigurationContext & RotationContext,
): Promise<void> {
    if ((await applyConfigPageRevision(moderatorName, configurationPorts(context))) === "stored") {
        await requestRefresh(rotationPorts(context));
    }
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

    await applyConfigPage(moderatorName, context);
}

/** The new comment, or undefined when it cannot count towards a comment cap. */
function getCountedComment(event: CommentCreateEvent, appSlug: string): NewComment | undefined {
    const postId = event.post?.id ?? "";
    if (postId === "") {
        console.warn("Ignoring a CommentCreate event without a post ID.");
        return undefined;
    }

    // The app's own comments (end notes on retiring live posts) never count towards a comment cap.
    return event.author?.name === appSlug ? undefined : { postId, reportedComments: event.post?.numComments ?? 0 };
}

export async function onCommentCreate(
    event: CommentCreateEvent,
    context: RotationContext & Readonly<{ appSlug: string }>,
): Promise<void> {
    const comment = getCountedComment(event, context.appSlug);
    if (comment !== undefined) {
        await rotateIfCapReached(comment, rotationPorts(context));
    }
}

export async function onPostDelete(event: Readonly<{ postId: string }>, context: RotationContext): Promise<void> {
    await forgetDeletedPost(event.postId, rotationPorts(context).livePosts);
}

// The refresh check starts first on install and upgrade: it is what recovers from any failure after it.
export async function onAppInstall(_event: unknown, context: ConfigurationContext & RotationContext): Promise<void> {
    await startRefreshCheck(rotationPorts(context).refreshJobs);
    await installConfigPage(configurationPorts(context).page);
    // A reinstall finds the moderators' thread configs on the page: they apply now, not at the next save.
    await applyConfigPage(undefined, context);
}

export async function onAppUpgrade(_event: unknown, context: RotationContext): Promise<void> {
    const ports = rotationPorts(context);
    await startRefreshCheck(ports.refreshJobs);
    await scheduleNextRefresh(ports);
}

export async function onRefreshJob(_event: unknown, context: RotationContext): Promise<void> {
    await refreshAllThreads(rotationPorts(context));
}

/**
 * The hourly check: a refresh is pending and on time, and the config page's current revision has been applied, in case
 * its wiki revision trigger failed or never came. The refresh comes first, so a config page that cannot be applied
 * cannot stop it.
 */
export async function onRefreshCheck(_event: unknown, context: ConfigurationContext & RotationContext): Promise<void> {
    await ensureRefreshPending(rotationPorts(context));
    await applyConfigPage(undefined, context);
}
