import type { UiResponse } from "@devvit/web/shared";
import { readLatestChanges } from "./changes/index.js";
import type { Change } from "./changes/index.js";
import { changesPorts, configurationPorts, rotationPorts } from "./composition.js";
import type { ChangesContext, ConfigurationContext, RotationContext } from "./composition.js";
import { getConfigPageStatus } from "./configuration/index.js";
import { identifyCaller } from "./moderators.js";
import type { Moderator, ModeratorsContext, NotAModerator } from "./moderators.js";
import { findLivePostLink, getThreadStatuses } from "./rotation/index.js";
import type { LivePostLink } from "./rotation/index.js";
import { layOutStatus, STATUS_FORM_NAME } from "./statusForm.js";
import { describeShownStatus } from "./statusText.js";

// The status: a mod-only menu item answers with a read-only form of every managed thread's state, and the form's one
// action opens a live post. Each handler identifies the caller before it reads anything else. The status only reads:
// it writes, schedules and alerts nothing, and echoes nothing from a request back to the UI.

/** What a status form submission asks for: the thread config whose live post to open, or none. */
export type StatusFormEvent = Readonly<{ configName?: string | undefined }>;

export type StatusContext = ChangesContext & ConfigurationContext & ModeratorsContext & RotationContext;

// A live post opens at Reddit's web origin followed by its permalink, never at a URL from the request.
const REDDIT_ORIGIN = "https://www.reddit.com";
const NO_LIVE_POST_NOTICE = "The thread config you chose has no live post now.";
const LATEST_CHANGES = 5;

function refuse(caller: NotAModerator, subredditName: string): UiResponse {
    const who = caller.username === undefined ? "a request with no user" : `u/${caller.username}`;
    console.warn(`Refused the status to ${who}: not a moderator of r/${subredditName}.`);
    return { showToast: `Only moderators of r/${subredditName} can see Sticky Manager's status.` };
}

/** The latest changes; a history that cannot be read is logged and shown as such, never hiding the rest. */
async function readChanges(now: Date, context: ChangesContext): Promise<readonly Change[] | "unreadable"> {
    try {
        return await readLatestChanges(LATEST_CHANGES, now, changesPorts(context));
    } catch (error: unknown) {
        console.error("The status could not read the change history:", error);
        return "unreadable";
    }
}

async function showStatus(
    moderator: Moderator,
    context: StatusContext,
    notice: string | undefined,
): Promise<UiResponse> {
    const now = new Date();
    const [config, changes] = await Promise.all([
        getConfigPageStatus(configurationPorts(context)),
        readChanges(now, context),
    ]);
    const threads =
        config.threadConfigs.kind === "readable"
            ? await getThreadStatuses(config.threadConfigs.configs, rotationPorts(context))
            : undefined;
    console.log(describeShownStatus(moderator.username, threads));
    return { showForm: { name: STATUS_FORM_NAME, form: layOutStatus({ now, config, threads, notice, changes }) } };
}

function navigateTo(link: LivePostLink, configName: string, moderator: Moderator): UiResponse {
    console.log(`Opened live post ${link.postId} of thread config ${configName} for u/${moderator.username}.`);
    return { navigateTo: `${REDDIT_ORIGIN}${link.permalink}` };
}

async function openLivePost(configName: string, moderator: Moderator, context: StatusContext): Promise<UiResponse> {
    const link = await findLivePostLink(configName, rotationPorts(context)).catch((error: unknown): "unreadable" => {
        console.error(
            `Could not open the live post of thread config ${configName} for u/${moderator.username}:`,
            error,
        );
        return "unreadable";
    });
    if (link === "unreadable") {
        return { showToast: "Could not open that live post. Try again shortly." };
    }

    return link === undefined
        ? await showStatus(moderator, context, NO_LIVE_POST_NOTICE)
        : navigateTo(link, configName, moderator);
}

/** The mod-only menu item: the status, for a moderator. */
export async function onStatusMenu(_event: unknown, context: StatusContext): Promise<UiResponse> {
    const caller = await identifyCaller(context);
    return caller.kind === "moderator"
        ? await showStatus(caller.moderator, context, undefined)
        : refuse(caller, context.subredditName);
}

/** The status form's submission: opens the chosen thread config's live post, or shows the status again. */
export async function onStatusForm(event: StatusFormEvent, context: StatusContext): Promise<UiResponse> {
    const caller = await identifyCaller(context);
    if (caller.kind !== "moderator") {
        return refuse(caller, context.subredditName);
    }

    return event.configName === undefined
        ? await showStatus(caller.moderator, context, undefined)
        : await openLivePost(event.configName, caller.moderator, context);
}
