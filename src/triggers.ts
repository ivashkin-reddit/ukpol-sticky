import { configurationPorts, rotationPorts } from "./composition.js";
import type { ConfigurationContext, RotationContext } from "./composition.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import {
    checkRefreshes,
    forgetDeletedPost,
    refreshThreadConfig,
    requestEveryThreadRefresh,
    rotateIfCapReached,
    scheduleEveryThreadRefresh,
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

export type PostDeleteEvent = Readonly<{ postId?: string | undefined }>;

/** A refresh job's thread config; absent for a job scheduled before refreshes were per thread config. */
export type RefreshJobEvent = Readonly<{ configName?: string | undefined }>;

// Why a refresh of every thread config is requested, as its log line ends.
const STORED_CONFIGS = "thread configs stored since the last refresh";
const PRE_UPGRADE_JOB = "a refresh scheduled before the upgrade";

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
        await requestEveryThreadRefresh(rotationPorts(context), STORED_CONFIGS);
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

export async function onPostDelete(event: PostDeleteEvent, context: RotationContext): Promise<void> {
    const postId = event.postId ?? "";
    if (postId === "") {
        console.warn("Ignoring a PostDelete event without a post ID.");
        return;
    }

    await forgetDeletedPost(postId, rotationPorts(context).livePosts);
}

// The refresh check starts first on install and upgrade: it is what recovers from any failure after it.
export async function onAppInstall(_event: unknown, context: ConfigurationContext & RotationContext): Promise<void> {
    await startRefreshCheck(rotationPorts(context).refreshJobs);
    await installConfigPage(configurationPorts(context).page);
    // A reinstall finds the moderators' thread configs on the page: they apply now, not at the next save.
    await applyConfigPage(undefined, context);
}

export async function onAppUpgrade(_event: unknown, context: ConfigurationContext & RotationContext): Promise<void> {
    const ports = rotationPorts(context);
    await startRefreshCheck(ports.refreshJobs);
    await scheduleEveryThreadRefresh(ports);
    // Last, so a refresh it requests for newly stored thread configs is not replaced by a rotation time.
    await applyConfigPage(undefined, context);
}

/**
 * A refresh job: it refreshes the thread config it names, or, scheduled before refreshes were per thread config,
 * requests a refresh of every thread config.
 */
export async function onRefreshJob(event: RefreshJobEvent, context: RotationContext): Promise<void> {
    const ports = rotationPorts(context);
    await (event.configName === undefined
        ? requestEveryThreadRefresh(ports, PRE_UPGRADE_JOB)
        : refreshThreadConfig(event.configName, ports));
}

/**
 * The hourly check: each thread config's refresh is pending and on time, and the config page's current revision has
 * been applied, in case its wiki revision trigger failed or never came. The refreshes come first, so a config page
 * that cannot be applied cannot stop them.
 */
export async function onRefreshCheck(_event: unknown, context: ConfigurationContext & RotationContext): Promise<void> {
    await checkRefreshes(rotationPorts(context));
    await applyConfigPage(undefined, context);
}
