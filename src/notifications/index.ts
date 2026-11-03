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
 * Keeps an alert to one per outage: the first caller to claim it sends the alert, and releasing it once the problem
 * is over lets the next outage alert again.
 */
export interface AlertLatch {
    /** True for the caller that should send the alert; false while an earlier claim stands. */
    readonly claim: () => Promise<boolean>;
    readonly release: () => Promise<void>;
}
