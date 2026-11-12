import type { PinChange, PostRef } from "./changes/index.js";

// "Pin to slot"'s wording, in CONTEXT.md's terms: the toasts a moderator sees and the lines the log keeps.

const MAX_TOAST_TITLE = 60;

export const PERMISSION_TOAST = "Pinning with Sticky Manager needs the Everything or Posts moderator permission.";
export const BUSY_TOAST = "That thread is being refreshed. Try again in a minute.";
export const UNCHANGED_TOAST = "Nothing to change.";

export function notModeratorToast(subredditName: string): string {
    return `Only moderators of r/${subredditName} can pin with Sticky Manager.`;
}

export function notThisSubredditToast(subredditName: string): string {
    return `That post is not in r/${subredditName}.`;
}

function quoted(title: string): string {
    return `"${title.length > MAX_TOAST_TITLE ? `${title.slice(0, MAX_TOAST_TITLE - 1)}…` : title}"`;
}

/** The toast for a change made. */
export function describeOutcome(change: PinChange): string {
    const post = quoted(change.post.title);
    switch (change.action) {
        case "pinned":
            return `Pinned ${post} to slot ${String(change.toSlot)}.`;
        case "moved":
            return `Moved ${post} to slot ${String(change.toSlot)}.`;
        case "relabelled":
            return `Changed the label of ${post}.`;
        case "unpinned":
            return `Unpinned ${post}.`;
    }
}

function describeLogAction(change: PinChange): string {
    const label = change.label ?? "no label";
    switch (change.action) {
        case "pinned":
            return `pinned post ${change.post.id} to slot ${String(change.toSlot)} (${label})`;
        case "moved":
            return `moved post ${change.post.id} from slot ${String(change.fromSlot)} to slot ${String(change.toSlot)} (${label})`;
        case "relabelled":
            return `changed the label of post ${change.post.id} in slot ${String(change.toSlot)} to ${change.label ?? "none"}`;
        case "unpinned":
            return `unpinned post ${change.post.id} from slot ${String(change.fromSlot)}`;
    }
}

/** The log line for a change made, standing alone: who, which post, which slots, and what Reddit unpinned. */
export function describePinLog(change: PinChange): string {
    const unpinned = change.unpinned === undefined ? "" : ` Reddit unpinned ${change.unpinned.id}.`;
    return `u/${change.moderator} ${describeLogAction(change)}.${unpinned}`;
}

/** Why the form is shown again: pinning would unpin `post`, which the moderator has not confirmed. */
export function confirmNotice(post: PostRef): string {
    return `Pinning this post unpins ${quoted(post.title)}: confirm below to go ahead.`;
}
