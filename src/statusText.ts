import { formatDistanceStrict } from "date-fns";
import type { Change, PinChange } from "./changes/index.js";
import { describeProblemForStatus } from "./configuration/index.js";
import type { ConfigPageStatus, Pin } from "./configuration/index.js";
import { OLD_REDDIT_SLOTS } from "./highlights/index.js";
import { needsAttention } from "./rotation/index.js";
import type {
    AttentionReason,
    CheckFinding,
    Handover,
    LastRefresh,
    LivePostStatus,
    ReadableThreadStatus,
    ThreadStatus,
    ThreadStatuses,
} from "./rotation/index.js";

// The status's wording, in CONTEXT.md's terms. Times are UTC, as postTime and the logs are, each with how long ago or
// how soon.

// An ISO time to the minute, "2026-04-21T10:00", is its first 16 characters.
const MINUTE_ISO_LENGTH = 16;
/** The most one field shows: a config problem or a failure can run long, and the log or modmail has it whole. */
export const MAX_FIELD_TEXT = 500;

export const UNREADABLE_SUMMARY = "Sticky Manager cannot read its stored thread configs.";

/** The most of a post title one change shows: five changes share a field. */
const MAX_CHANGE_TITLE = 80;

/** `at` to the minute in UTC: "2026-04-21 10:00 UTC". */
export function formatUtc(at: Date): string {
    return `${at.toISOString().slice(0, MINUTE_ISO_LENGTH).replace("T", " ")} UTC`;
}

/** `at` in UTC, with how long before or after `now` it is: "2026-04-21 12:30 UTC (in 3 hours)". */
export function formatTime(at: Date, now: Date): string {
    return `${formatUtc(at)} (${formatDistanceStrict(at, now, { addSuffix: true })})`;
}

/** `text`, cut to MAX_FIELD_TEXT characters, ending in an ellipsis, when longer. */
export function cut(text: string): string {
    return text.length > MAX_FIELD_TEXT ? `${text.slice(0, MAX_FIELD_TEXT - 1)}…` : text;
}

function count(amount: number, one: string, many: string): string {
    return `${String(amount)} ${amount === 1 ? one : many}`;
}

function needCount(amount: number): string {
    return `${String(amount)} ${amount === 1 ? "needs" : "need"} attention`;
}

/** The summary: how many thread configs are in force, how many need attention, and whether the check is scheduled. */
export function describeSummary(statuses: ThreadStatuses): string {
    const total = statuses.threads.length;
    const needing = statuses.threads.filter(needsAttention).length;
    const counts = `${count(total, "managed thread", "managed threads")}: ${String(total - needing)} running, ${needCount(needing)}.`;
    return statuses.hourlyCheckScheduled
        ? counts
        : `${counts} The hourly refresh check is not scheduled; the next refresh starts it again.`;
}

/** The config page's state. Stored thread configs that cannot be read come first: then nothing refreshes. */
export function describeConfigPage(status: ConfigPageStatus): string {
    if (status.threadConfigs.kind === "unreadable") {
        return "The stored thread configs cannot be read, so refreshes have stopped. Save the config page again to store a fresh copy.";
    }

    const { page } = status;
    switch (page.kind) {
        case "inForce":
            return page.savedBy === undefined
                ? "Its latest revision is in force."
                : `Its latest revision is in force, saved by /u/${page.savedBy}.`;
        case "rejected":
            return page.problem === undefined
                ? "Its latest revision was rejected; saving the page again applies it."
                : `Its latest revision was rejected: ${describeProblemForStatus(page.problem)} The thread configs from its last accepted revision stay in force.`;
        case "unchecked":
            return "Its latest revision has not been applied yet; the refresh check applies it within the hour.";
        case "unavailable":
            return "The config page could not be read.";
    }
}

/**
 * Where a live post sits in the highlights, and where its thread config puts it when that differs: moderators may move
 * it by hand, and it returns at its next rotation.
 */
function describePin(slot: number | undefined, pin: Pin): string {
    const where =
        slot === undefined
            ? "not pinned"
            : `pinned in slot ${String(slot)}${slot <= OLD_REDDIT_SLOTS ? " (old.reddit sticky)" : ""}`;
    if (pin.kind === "slot" && slot !== pin.slot) {
        const returns = slot === undefined ? "it is pinned" : "it returns";
        return `${where}; set to slot ${String(pin.slot)}, ${returns} at its next rotation`;
    }

    return pin.kind === "keepSlot" && slot === undefined ? `${where}; it is pinned again at its next rotation` : where;
}

export function describeLivePost(livePost: LivePostStatus, pin: Pin, now: Date): string {
    switch (livePost.kind) {
        case "none":
            return "None: a refresh publishes one.";
        case "unreadable":
            return `Could not read ${livePost.postId} from Reddit.`;
        case "readable":
            return `${livePost.title} (${livePost.id}), ${describePin(livePost.slot, pin)}, posted ${formatTime(livePost.createdAt, now)}`;
    }
}

/** Comments against the live post's comment cap, or the count alone when no cap is stored for it. */
export function describeComments(livePost: Exclude<LivePostStatus, Readonly<{ kind: "none" }>>): string {
    if (livePost.kind === "unreadable") {
        return "Unknown";
    }

    return livePost.commentCap === undefined
        ? String(livePost.comments)
        : `${String(livePost.comments)} of ${String(livePost.commentCap)}`;
}

export function describeNextRefresh(status: ReadableThreadStatus, now: Date): string {
    const { nextRefreshAt, nextRefreshReason } = status.refreshStatus;
    if (nextRefreshAt === undefined) {
        return status.hasSchedule ? "None scheduled" : "None: only its comment cap rotates it";
    }

    const time = formatTime(nextRefreshAt, now);
    return nextRefreshReason === undefined ? time : `${time}, ${nextRefreshReason}`;
}

export function describeLastRefresh(lastRefresh: LastRefresh | undefined, now: Date): string {
    if (lastRefresh === undefined) {
        return "None yet";
    }

    return lastRefresh.outcome === "failed"
        ? `Failed ${formatTime(lastRefresh.at, now)}: ${lastRefresh.failure}`
        : `Succeeded ${formatTime(lastRefresh.at, now)}`;
}

export function describeLastSuccess(lastSuccessAt: Date | undefined, now: Date): string {
    return lastSuccessAt === undefined ? "Never" : formatTime(lastSuccessAt, now);
}

export function describeHandover(handover: Handover): string {
    return `Unfinished: new post ${handover.newPostId} is published; the next refresh finishes the handover.`;
}

function describeFinding(finding: CheckFinding): string {
    switch (finding.kind) {
        case "stuck":
            return `Its refresh due at ${formatUtc(finding.stuckAt)} has not run; the refresh check replaces it within the hour.`;
        case "missing":
            return "No refresh of it is pending; the refresh check requests one within the hour.";
        case "unapplied":
            return "Its saved thread config has not been applied; the refresh check requests a refresh within the hour.";
        case "no live post":
            return "It has no live post; the refresh check requests a refresh within the hour.";
        case "unfinished handover":
            return "Its handover is unfinished and no retry is pending; the refresh check requests a refresh within the hour.";
    }
}

/** One reason a thread config needs attention, saying what happens next. */
export function describeAttention(reason: AttentionReason): string {
    switch (reason.kind) {
        case "failed":
            return "Its last refresh failed; it is retried within 15 minutes.";
        case "check":
            return describeFinding(reason.finding);
        case "postUnreadable":
            return "Its live post could not be read from Reddit.";
    }
}

function briefFinding(finding: CheckFinding): string {
    switch (finding.kind) {
        case "stuck":
            return "its refresh has not run";
        case "missing":
            return "no refresh of it is pending";
        case "unapplied":
            return "its saved thread config is not applied";
        case "no live post":
            return "it has no live post";
        case "unfinished handover":
            return "its handover is unfinished";
    }
}

function briefReason(reason: AttentionReason): string {
    switch (reason.kind) {
        case "failed":
            return "its last refresh failed";
        case "check":
            return briefFinding(reason.finding);
        case "postUnreadable":
            return "its live post could not be read";
    }
}

function briefReasons(status: ThreadStatus): string {
    return status.kind === "unreadable"
        ? `${status.configName}: its status could not be read`
        : `${status.configName}: ${status.attention.map(briefReason).join(", ")}`;
}

function quoted(title: string): string {
    return `"${title.length > MAX_CHANGE_TITLE ? `${title.slice(0, MAX_CHANGE_TITLE - 1)}…` : title}"`;
}

function describePinAction(change: PinChange): string {
    const post = quoted(change.post.title);
    const label = change.label === undefined ? "" : ` (${change.label})`;
    switch (change.action) {
        case "pinned":
            return `pinned ${post} to slot ${String(change.toSlot)}${label}`;
        case "moved":
            return `moved ${post} from slot ${String(change.fromSlot)} to slot ${String(change.toSlot)}`;
        case "relabelled":
            return `changed the label of ${post} in slot ${String(change.toSlot)} to ${change.label ?? "none"}`;
        case "unpinned":
            return `unpinned ${post} from slot ${String(change.fromSlot)}`;
    }
}

/** One change, for the status: when, who, and what. */
export function describeChange(change: Change): string {
    const unpinned = change.unpinned === undefined ? "" : `; Reddit unpinned ${quoted(change.unpinned.title)}`;
    return `${formatUtc(change.at)}, u/${change.moderator} ${describePinAction(change)}${unpinned}.`;
}

/** The latest changes, newest first, one a line; or that there are none, or that they could not be read. */
export function describeChanges(changes: readonly Change[] | "unreadable"): string {
    if (changes === "unreadable") {
        return "Could not read the change history.";
    }

    return changes.length === 0 ? "No changes yet." : changes.map(describeChange).join("\n");
}

/** The log line for a status shown: who saw it, the counts, and why each thread config needing attention does. */
export function describeShownStatus(username: string, threads: ThreadStatuses | undefined): string {
    if (threads === undefined) {
        return `Showed the status to u/${username}: the stored thread configs cannot be read.`;
    }

    const needing = threads.threads.filter(needsAttention);
    const counts = `${count(threads.threads.length, "thread config", "thread configs")}, ${needCount(needing.length)}`;
    const reasons = needing.map(briefReasons).join("; ");
    return `Showed the status to u/${username}: ${counts}${reasons === "" ? "" : ` (${reasons})`}.`;
}
