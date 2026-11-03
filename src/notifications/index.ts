// Notifications: delivers moderator alerts. It knows nothing of managed threads; callers write each alert's text.
// The composition root (src/composition.ts) picks the channel: adapters/modmail.ts today.

/** A message to the subreddit's moderators about something they must act on. */
export interface ModeratorAlert {
    readonly subject: string;
    readonly bodyMarkdown: string;
}

/** Delivers a moderator alert; rejects when it cannot be delivered. */
export type NotifyModerators = (alert: ModeratorAlert) => Promise<void>;

/**
 * Keeps an alert to one per outage: the first caller to claim it sends the alert and confirms it, and releasing it
 * once the problem is over lets the next outage alert again. A claim never confirmed (its caller died before the alert
 * went out) lapses after a few minutes, so a later caller sends the alert instead.
 */
export interface AlertLatch {
    /** True for the caller that should send the alert; false while an earlier claim stands. */
    readonly claim: () => Promise<boolean>;
    /** Records that the claimant sent the alert: the claim then stands until it is released. */
    readonly confirm: () => Promise<void>;
    readonly release: () => Promise<void>;
}
