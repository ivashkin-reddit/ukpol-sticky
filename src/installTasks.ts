import type { WikiPagePermissionLevel } from "@devvit/public-api";
import { CONFIG_PAGE } from "./config.js";
import { getSubredditName } from "./ports.js";
import type { SubredditNamePort } from "./ports.js";
import { scheduleNextRefresh } from "./stickyManager.js";
import type { StickyContext } from "./stickyManager.js";

// WORKAROUND: WikiPagePermissionLevel.MODS_ONLY is written as its numeric value
//   cause: @devvit/public-api 0.15.2 re-exports @devvit/reddit with `export type *`, and @devvit/reddit's package
//          exports reach its models (where the WikiPagePermissionLevel enum lives) only as types, so the enum has no
//          importable runtime value; `WikiPagePermissionLevel.MODS_ONLY` would be undefined at runtime.
//   blocked: the enum value ships inside Devvit's published packages; this repo cannot export it.
//   fix: Devvit exports WikiPagePermissionLevel as a value; then pass WikiPagePermissionLevel.MODS_ONLY directly.
//   until: a value import of WikiPagePermissionLevel from "@devvit/public-api" compiles without TS1362.
// The enum-member type annotation keeps tsc checking the literal against Devvit's definition.
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- see the WORKAROUND above
const MODS_ONLY: WikiPagePermissionLevel.MODS_ONLY = 2;

const CONFIG_PAGE_TEMPLATE = [
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
    "# sticky: true",
    "# maxComments: 200",
    "# body: |",
    "#     Welcome to the UKPol World Megathread",
    "#",
    "#     This is a place to discuss all things related to the world.",
    "# endNote: |",
    "#     The megathread has ended. Please continue the discussion in the latest thread.",
    "# lockOnRefresh: true",
    "",
    "# Omit both frequency and postTime to keep a megathread open until maxComments is reached.",
    "# frequency options: daily, mondays, tuesdays, wednesdays, thursdays, fridays, saturdays, sundays",
    "# postTime format: HH:mm (24-hour format). This is in UTC.",
    "# sticky is optional and controls whether the post is stickied when it is created.",
    "# endNote is optional and will create a sticky comment when the post is refreshed.",
    "# lockOnRefresh is optional and will lock the post when it is refreshed.",
    "",
    "# Just like Automoderator, you can create multiple sticky posts by adding more entries, separated with ---.",
].join("\n");

export type InstallContext = SubredditNamePort & Readonly<{
    reddit: Readonly<{
        updateWikiPage: (options: Readonly<{ content: string; page: string; subredditName: string }>) => Promise<unknown>;
        updateWikiPageSettings: (options: Readonly<{
            listed: boolean;
            page: string;
            permLevel: WikiPagePermissionLevel;
            subredditName: string;
        }>) => Promise<unknown>;
    }>;
}>;

export async function handleAppInstall (_event: unknown, context: InstallContext): Promise<void> {
    const subredditName = await getSubredditName(context);
    await context.reddit.updateWikiPage({ subredditName, page: CONFIG_PAGE, content: CONFIG_PAGE_TEMPLATE });
    await context.reddit.updateWikiPageSettings({ subredditName, page: CONFIG_PAGE, permLevel: MODS_ONLY, listed: true });
}

export async function handleAppUpgrade (_event: unknown, context: StickyContext): Promise<void> {
    await scheduleNextRefresh(context);
}
