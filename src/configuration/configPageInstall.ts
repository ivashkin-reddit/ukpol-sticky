import type { ConfigPage } from "./ports.js";

// The commented example written to a new config page: the format moderators follow when defining thread configs.
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

/** Writes the commented example to the config page, which becomes editable by moderators only. */
export async function installConfigPage(page: ConfigPage): Promise<void> {
    await page.install(CONFIG_PAGE_TEMPLATE);
}
