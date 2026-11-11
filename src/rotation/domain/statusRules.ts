import { findCheckFinding } from "./refreshRules.js";
import type { CheckFinding, ThreadCheckState } from "./refreshRules.js";

/** Why the status shows a thread config as needing attention. */
export type AttentionReason =
    | Readonly<{ kind: "check"; finding: CheckFinding }>
    | Readonly<{ kind: "failed" }>
    | Readonly<{ kind: "postUnreadable" }>;

/** What the status reads of a thread config in force: what the refresh check reads, and two facts of its own. */
export interface AttentionState extends ThreadCheckState {
    readonly lastRefreshFailed: boolean;
    /** False when its live post could not be read from Reddit. */
    readonly postReadable: boolean;
}

const FAILED: AttentionReason = { kind: "failed" };
const POST_UNREADABLE: AttentionReason = { kind: "postUnreadable" };

function checkReason(finding: CheckFinding): AttentionReason {
    return { kind: "check", finding };
}

/**
 * Why a thread config needs attention, if it does: its last refresh failed, the refresh check would request a refresh
 * of it, or its live post cannot be read. The check's own rule decides the second, so the status and the check cannot
 * disagree; a refresh due within the retry delay, or one running, is no reason.
 */
export function findAttentionReasons(state: AttentionState, now: Date): readonly AttentionReason[] {
    const finding = findCheckFinding(state, now);
    return [
        ...(state.lastRefreshFailed ? [FAILED] : []),
        ...(finding === undefined ? [] : [checkReason(finding)]),
        ...(state.postReadable ? [] : [POST_UNREADABLE]),
    ];
}

/** `items` with those `first` picks ahead of the rest, each part in its original order. */
export function putFirst<Item>(items: readonly Item[], first: (item: Item) => boolean): readonly Item[] {
    return [...items.filter(first), ...items.filter((item: Item): boolean => !first(item))];
}
