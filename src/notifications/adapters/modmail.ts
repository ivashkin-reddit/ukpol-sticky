import type { TriggerContext } from "@devvit/public-api";
import { asT5ID } from "@devvit/public-api/types/tid.js";
import type { ModeratorAlert, NotifyModerators } from "../index.js";

export type ModmailContext = Readonly<{
    reddit: Readonly<{
        modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "createModInboxConversation">>;
    }>;
    subredditId: string;
}>;

/** Delivers moderator alerts as new conversations in the subreddit's mod inbox. */
export function modmailNotifier(context: ModmailContext): NotifyModerators {
    return async (alert: ModeratorAlert): Promise<void> => {
        await context.reddit.modMail.createModInboxConversation({
            subredditId: asT5ID(context.subredditId),
            subject: alert.subject,
            bodyMarkdown: alert.bodyMarkdown,
        });
        console.log(`Sent moderator alert by modmail: ${alert.subject}`);
    };
}
