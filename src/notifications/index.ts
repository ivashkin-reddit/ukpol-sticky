// Notifications: delivers moderator alerts. It knows nothing of managed threads; callers write each alert's text.

import type { TriggerContext } from "@devvit/public-api";
import { asT5ID } from "@devvit/public-api/types/tid.js";

/** A message to the subreddit's moderators about something they must act on. */
export interface ModeratorAlert {
    readonly subject: string;
    readonly bodyMarkdown: string;
}

export type NotificationContext = Readonly<{
    reddit: Readonly<{
        modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "createModInboxConversation">>;
    }>;
    subredditId: string;
}>;

/** Delivers the alert to the subreddit's moderators. Modmail is the only channel today. */
export async function notifyModerators(context: NotificationContext, alert: ModeratorAlert): Promise<void> {
    await context.reddit.modMail.createModInboxConversation({
        subredditId: asT5ID(context.subredditId),
        subject: alert.subject,
        bodyMarkdown: alert.bodyMarkdown,
    });
}
