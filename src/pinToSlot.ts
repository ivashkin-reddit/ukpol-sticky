import type { UiResponse } from "@devvit/web/shared";
import type { PostRef } from "./changes/index.js";
import { highlightsPorts, rotationPorts } from "./composition.js";
import type { HighlightsContext } from "./composition.js";
import { describeHighlights, isHighlightLabel, MAX_HIGHLIGHTS, pinToSlot } from "./highlights/index.js";
import type { HighlightLabel, PinOutcome } from "./highlights/index.js";
import { canManagePosts, identifyCaller } from "./moderators.js";
import type { Moderator, ModeratorsContext } from "./moderators.js";
import { KEEP_PINNED, layOutPinForm, NO_LABEL, NOT_PINNED, PIN_FORM_NAME } from "./pinForm.js";
import {
    BUSY_TOAST,
    confirmNotice,
    describeOutcome,
    describePinLog,
    keptToast,
    notModeratorToast,
    notThisSubredditToast,
    PERMISSION_TOAST,
    UNCHANGED_TOAST,
} from "./pinText.js";
import { findManagingThread } from "./rotation/index.js";

// "Pin to slot": a post menu item answers with the pin form, and the form's submission pins the post. Each handler
// identifies the caller and checks the Everything or Posts permission before it reads anything else, and reads the
// post from Reddit rather than trusting the request. Nothing from a request is echoed back.

/** The post a post menu item was pressed on, when it is a post. */
export type PinMenuEvent = Readonly<{ postId: string | undefined }>;

/** A pin form submission's choices, each as submitted, not yet checked. */
export type PinFormEvent = Readonly<{
    postId: string | undefined;
    slot: string | undefined;
    label: string | undefined;
    confirmUnpin: string | undefined;
}>;

export type PinContext = HighlightsContext & ModeratorsContext;

type Authorisation =
    Readonly<{ kind: "allowed"; moderator: Moderator }> | Readonly<{ kind: "refused"; response: UiResponse }>;

/** Whether the caller may pin: a moderator with the Everything or Posts permission; otherwise the refusal. */
async function authorise(context: PinContext): Promise<Authorisation> {
    const caller = await identifyCaller(context);
    if (caller.kind !== "moderator") {
        const who = caller.username === undefined ? "a request with no user" : `u/${caller.username}`;
        console.warn(`Refused Pin to slot to ${who}: not a moderator of r/${context.subredditName}.`);
        return { kind: "refused", response: { showToast: notModeratorToast(context.subredditName) } };
    }

    if (!canManagePosts(caller.moderator)) {
        console.warn(
            `Refused Pin to slot to u/${caller.moderator.username}: needs the Everything or Posts permission.`,
        );
        return { kind: "refused", response: { showToast: PERMISSION_TOAST } };
    }

    return { kind: "allowed", moderator: caller.moderator };
}

/** The post, read from Reddit and checked to be this subreddit's; undefined otherwise. */
async function readPost(postId: string | undefined, context: PinContext): Promise<PostRef | undefined> {
    return postId === undefined ? undefined : await highlightsPorts(context).highlights.readPost(postId);
}

async function showForm(post: PostRef, notice: string | undefined, context: PinContext): Promise<UiResponse> {
    const [highlights, managedBy] = await Promise.all([
        describeHighlights(post.id, highlightsPorts(context).highlights),
        findManagingThread(post.id, rotationPorts(context)),
    ]);
    return { showForm: { name: PIN_FORM_NAME, form: layOutPinForm({ post, highlights, managedBy, notice }) } };
}

/** The slot chosen: 1 to 6, undefined for "Not pinned"; "invalid" for anything else, a missing choice included. */
function parseSlot(value: string | undefined): number | "invalid" | undefined {
    if (value === NOT_PINNED) {
        return undefined;
    }

    const slot = Number(value);
    return Number.isInteger(slot) && slot >= 1 && slot <= MAX_HIGHLIGHTS && String(slot) === value ? slot : "invalid";
}

/** The label chosen, undefined for "None"; "invalid" for anything but the four, a missing choice included. */
function parseLabel(value: string | undefined): HighlightLabel | "invalid" | undefined {
    if (value === NO_LABEL) {
        return undefined;
    }

    return value !== undefined && isHighlightLabel(value) ? value : "invalid";
}

type AllowedPin = Readonly<{ kind: "allowed"; moderator: Moderator; post: PostRef }>;
type PinAccess = AllowedPin | Readonly<{ kind: "refused"; response: UiResponse }>;

/** The toast for what "Pin to slot" did, after its log line. The form answers a confirmation itself. */
function answer(outcome: Exclude<PinOutcome, Readonly<{ kind: "confirm" }>>, access: AllowedPin): UiResponse {
    const who = `u/${access.moderator.username}`;
    switch (outcome.kind) {
        case "changed":
            console.log(describePinLog(outcome.change));
            return { showToast: describeOutcome(outcome.change) };
        case "unchanged":
            console.log(`${who} chose what post ${access.post.id} already had, so Pin to slot changed nothing.`);
            return { showToast: UNCHANGED_TOAST };
        case "busy":
            console.log(`${who} could not pin post ${access.post.id}: a refresh of its thread holds the lock.`);
            return { showToast: BUSY_TOAST };
    }
}

/** Shows the pin form again, logging why. */
async function showAgain(
    access: AllowedPin,
    reason: Readonly<{ notice: string | undefined; why: string }>,
    context: PinContext,
): Promise<UiResponse> {
    console.log(
        `Showed the pin form for post ${access.post.id} to u/${access.moderator.username} again: ${reason.why}.`,
    );
    return await showForm(access.post, reason.notice, context);
}

/** The moderator allowed to pin, and the post read from Reddit as this subreddit's; otherwise the refusal. */
async function authorisePost(postId: string | undefined, context: PinContext): Promise<PinAccess> {
    const authorisation = await authorise(context);
    if (authorisation.kind === "refused") {
        return authorisation;
    }

    const post = await readPost(postId, context);
    return post === undefined
        ? { kind: "refused", response: { showToast: notThisSubredditToast(context.subredditName) } }
        : { kind: "allowed", moderator: authorisation.moderator, post };
}

/** Shows the pin form again, asking the moderator to confirm the post Reddit would unpin. */
async function askToConfirm(
    access: AllowedPin,
    pending: Readonly<{ wouldUnpin: PostRef; confirmed: string | undefined }>,
    context: PinContext,
): Promise<UiResponse> {
    const confirmed = pending.confirmed === undefined ? "nothing was confirmed" : "another post was confirmed";
    const why = `pinning it would unpin ${pending.wouldUnpin.id}, and ${confirmed}`;
    return await showAgain(access, { notice: confirmNotice(pending.wouldUnpin), why }, context);
}

/** The moderator chose to keep the highlights as they are: nothing is pinned, and the toast names what stays. */
async function keepPinned(access: AllowedPin, context: PinContext): Promise<UiResponse> {
    const view = await describeHighlights(access.post.id, highlightsPorts(context).highlights);
    console.log(
        `u/${access.moderator.username} chose to keep the highlights as they are, so post ${access.post.id} was not pinned.`,
    );
    return { showToast: keptToast(view.wouldUnpin) };
}

/** The slot and label chosen; undefined when either is one the form never offers. */
function readChoices(
    event: PinFormEvent,
): Readonly<{ slot: number | undefined; label: HighlightLabel | undefined }> | undefined {
    const slot = parseSlot(event.slot);
    const label = parseLabel(event.label);
    return slot === "invalid" || label === "invalid" ? undefined : { slot, label };
}

/** The post menu item: the pin form for the post, for a moderator who may change posts. */
export async function onPinMenu(event: PinMenuEvent, context: PinContext): Promise<UiResponse> {
    const access = await authorisePost(event.postId, context);
    return access.kind === "refused" ? access.response : await showForm(access.post, undefined, context);
}

/**
 * The pin form's submission: pins, moves, relabels or unpins the post. A choice the form never offers shows the form
 * again; a full list the moderator has not confirmed shows it again with the post Reddit would unpin.
 */
export async function onPinForm(event: PinFormEvent, context: PinContext): Promise<UiResponse> {
    const access = await authorisePost(event.postId, context);
    if (access.kind === "refused") {
        return access.response;
    }

    const choices = readChoices(event);
    if (choices === undefined) {
        return await showAgain(
            access,
            { notice: undefined, why: "its slot or label is not one the form offers" },
            context,
        );
    }

    if (event.confirmUnpin === KEEP_PINNED) {
        return await keepPinned(access, context);
    }

    const outcome = await pinToSlot(
        { moderator: access.moderator.username, post: access.post, ...choices, confirmedUnpin: event.confirmUnpin },
        highlightsPorts(context),
    );
    return outcome.kind === "confirm"
        ? await askToConfirm(access, { wouldUnpin: outcome.wouldUnpin, confirmed: event.confirmUnpin }, context)
        : answer(outcome, access);
}
