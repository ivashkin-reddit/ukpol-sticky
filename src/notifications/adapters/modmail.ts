import type { RedditClient } from "@devvit/web/server";
import { T5 as asSubredditId } from "@devvit/web/shared";
import type { ModeratorAlert, NotifyModerators } from "../index.js";

export type ModmailContext = Readonly<{
    reddit: Readonly<{
        modMail: Readonly<Pick<RedditClient["modMail"], "createModInboxConversation">>;
    }>;
    subredditId: string;
}>;

/** Delivers moderator alerts as new conversations in the subreddit's mod inbox. */
export function modmailNotifier(context: ModmailContext): NotifyModerators {
    return async (alert: ModeratorAlert): Promise<void> => {
        await context.reddit.modMail.createModInboxConversation({
            subredditId: asSubredditId(context.subredditId),
            subject: alert.subject,
            bodyMarkdown: alert.bodyMarkdown,
        });
        console.log(`Sent moderator alert by modmail: ${alert.subject}`);
    };
}
