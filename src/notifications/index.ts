// Notifications: delivers moderator alerts. It knows nothing of managed threads; callers write each alert's text.
// The composition root (src/composition.ts) picks the channel: adapters/modmail.ts today.

/** A message to the subreddit's moderators about something they must act on. */
export interface ModeratorAlert {
    readonly subject: string;
    readonly bodyMarkdown: string;
}

/** Delivers a moderator alert; rejects when it cannot be delivered. */
export type NotifyModerators = (alert: ModeratorAlert) => Promise<void>;
