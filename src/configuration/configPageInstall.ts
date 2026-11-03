import type { ConfigPage } from "./ports.js";

// The commented example written to a new config page: the format moderators follow when defining thread configs.
const CONFIG_PAGE_TEMPLATE = [
    "# Sticky Manager configuration file",
    "# Each entry on this page defines one recurring thread, written in YAML. Sticky Manager publishes each thread's",
    "# posts, stickies them if asked, and replaces them on their schedule or when they reach maxComments.",
    "# Full reference: https://github.com/ivashkin-reddit/ukpol-sticky#configuration",
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
    "# Omit both frequency and postTime to keep a thread open until it reaches maxComments.",
    "# frequency options: daily, mondays, tuesdays, wednesdays, thursdays, fridays, saturdays, sundays",
    "# postTime format: HH:mm (24-hour), always in UTC.",
    "# sticky is optional and stickies each new post.",
    "# endNote is optional and is pinned as a comment on the old post once its replacement is published.",
    "# lockOnRefresh is optional and locks the old post when it is replaced.",
    "",
    "# As with AutoModerator, define more threads by adding entries separated by a line containing only ---.",
].join("\n");

/** Writes the commented example to the config page, which becomes editable by moderators only. */
export async function installConfigPage(page: ConfigPage): Promise<void> {
    await page.install(CONFIG_PAGE_TEMPLATE);
}
