import type { WikiPagePermissionLevel } from "@devvit/web/server";
import type { SubredditNamePort } from "../../platform/index.js";
import { CONFIG_PAGE } from "../domain/threadConfig.js";
import type { ConfigPage, ConfigPageRevision } from "../ports.js";

// WORKAROUND: WikiPagePermissionLevel.MODS_ONLY is written as its numeric value
//   cause: @devvit/web/server 0.15.2 re-exports @devvit/reddit, whose index exports its models (where the
//          WikiPagePermissionLevel enum lives) with `export type *`, so the enum has no importable runtime value;
//          `WikiPagePermissionLevel.MODS_ONLY` would be undefined at runtime.
//   blocked: the enum value ships inside Devvit's published packages; this repo cannot export it.
//   fix: Devvit exports WikiPagePermissionLevel as a value; then pass WikiPagePermissionLevel.MODS_ONLY directly.
//   until: a value import of WikiPagePermissionLevel from "@devvit/web/server" compiles (today: TS1485, a type-only
//          declaration).
// The enum-member type annotation keeps tsc checking the literal against Devvit's definition.
// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-assignment -- see the WORKAROUND above
const MODS_ONLY: WikiPagePermissionLevel.MODS_ONLY = 2;

export type WikiConfigPageContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getWikiPage: (
                subredditName: string,
                page: string,
            ) => Promise<
                Readonly<{
                    content: string;
                    revisionId: string;
                    revisionAuthor?: Readonly<{ username: string }> | undefined;
                }>
            >;
            getWikiPages: (subredditName: string) => Promise<readonly string[]>;
            updateWikiPage: (
                options: Readonly<{ content: string; page: string; subredditName: string }>,
            ) => Promise<unknown>;
            updateWikiPageSettings: (
                options: Readonly<{
                    listed: boolean;
                    page: string;
                    permLevel: WikiPagePermissionLevel;
                    subredditName: string;
                }>,
            ) => Promise<unknown>;
        }>;
    }>;

async function readRevision(context: WikiConfigPageContext): Promise<ConfigPageRevision | undefined> {
    const { subredditName } = context;
    try {
        const page = await context.reddit.getWikiPage(subredditName, CONFIG_PAGE);
        const revision = { content: page.content, revisionId: page.revisionId };
        return page.revisionAuthor === undefined ? revision : { ...revision, authorName: page.revisionAuthor.username };
    } catch (error: unknown) {
        console.error(
            `Could not read the config page ${CONFIG_PAGE} in r/${subredditName}, so its revision is not applied:`,
            error,
        );
        return undefined;
    }
}

/**
 * The config page's current content, or undefined when the subreddit's wiki has no such page. Absence is read from the
 * wiki's page list, never inferred from a failed read: a read can fail for an existing page (Reddit unavailable, a
 * permissions error), and treating that as absence would replace the moderators' thread configs with the template.
 */
async function readExistingContent(context: WikiConfigPageContext, subredditName: string): Promise<string | undefined> {
    if (!(await context.reddit.getWikiPages(subredditName)).includes(CONFIG_PAGE)) {
        return undefined;
    }

    return (await context.reddit.getWikiPage(subredditName, CONFIG_PAGE)).content;
}

async function install(context: WikiConfigPageContext, content: string): Promise<void> {
    const { subredditName } = context;
    // A reinstall finds the moderators' thread configs on the page; replacing them would forget every live post.
    if (((await readExistingContent(context, subredditName)) ?? "").trim() === "") {
        await context.reddit.updateWikiPage({ subredditName, page: CONFIG_PAGE, content });
    } else {
        console.log(`Kept the existing content of the config page ${CONFIG_PAGE}.`);
    }

    await context.reddit.updateWikiPageSettings({
        subredditName,
        page: CONFIG_PAGE,
        permLevel: MODS_ONLY,
        listed: true,
    });
}

/** The config page as a page on the subreddit's wiki. */
export function wikiConfigPage(context: WikiConfigPageContext): ConfigPage {
    return {
        read: async (): Promise<ConfigPageRevision | undefined> => await readRevision(context),
        install: async (content: string): Promise<void> => {
            await install(context, content);
        },
    };
}
