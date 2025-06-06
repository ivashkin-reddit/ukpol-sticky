import { AppInstall, AppUpgrade } from "@devvit/protos";
import { TriggerContext, WikiPagePermissionLevel } from "@devvit/public-api";
import { scheduleNextRefresh } from "./stickyManager.js";

export async function handleAppInstall (_: AppInstall, context: TriggerContext) {
    const lines = [
        "# Sticky Manager configuration file",
        "# This file is used to configure sticky posts for your subreddit.",
        "# Each configuration entry defines a sticky post with its own settings, using YAML.",
        "",
        "# Example:",
        "",
        "# name: world-megathread",
        "# enabled: true",
        "# title: World Megathread for {{date dd/MM/yyyy}}",
        "# frequency: daily",
        "# postTime: 01:00",
        "# stickyPosition: 1",
        "# maxComments: 200",
        "# body: |",
        "#     Welcome to the UKPol World Megathread",
        "#",
        "#     This is a place to discuss all things related to the world.",
        "# endNote: |",
        "#     The megathread has ended. Please continue the discussion in the latest thread.",
        "# lockOnRefresh: true",
        "",
        "# frequency options: daily, mondays, tuesdays, wednesdays, thursdays, fridays, saturdays, sundays",
        "# postTime format: HH:mm (24-hour format). This is in UTC.",
        "# stickyPosition: 1 or 2. Omit if you don't want to set a sticky position.",
        "# endNote is optional and will create a sticky comment when the post is refreshed.",
        "# lockOnRefresh is optional and will lock the post when it is refreshed.",
        "",
        "# Just like Automoderator, you can create multiple sticky posts by adding more entries, separated with ---.",
    ];

    const configContent = lines.join("\n");
    await context.reddit.updateWikiPage({
        subredditName: context.subredditName ?? await context.reddit.getCurrentSubredditName(),
        page: "stickymgr/config",
        content: configContent,
    });

    await context.reddit.updateWikiPageSettings({
        subredditName: context.subredditName ?? await context.reddit.getCurrentSubredditName(),
        page: "stickymgr/config",
        permLevel: WikiPagePermissionLevel.MODS_ONLY,
        listed: true,
    });
}

export async function handleAppUpgrade (_: AppUpgrade, context: TriggerContext) {
    await scheduleNextRefresh(context);
}
