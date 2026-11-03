import type { WikiPagePermissionLevel } from "@devvit/public-api";
import { getSubredditName } from "../../platform/index.js";
import type { SubredditNamePort } from "../../platform/index.js";
import { CONFIG_PAGE } from "../domain/threadConfig.js";
import type { ConfigPage, ConfigPageRevision } from "../ports.js";

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

export type WikiConfigPageContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getWikiPage: (
                subredditName: string,
                page: string,
            ) => Promise<Readonly<{ content: string; revisionId: string }>>;
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
    const subredditName = await getSubredditName(context);
    try {
        const page = await context.reddit.getWikiPage(subredditName, CONFIG_PAGE);
        return { content: page.content, revisionId: page.revisionId, subredditName };
    } catch (error: unknown) {
        console.error(`Failed to fetch wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, error);
        return undefined;
    }
}

async function install(context: WikiConfigPageContext, content: string): Promise<void> {
    const subredditName = await getSubredditName(context);
    await context.reddit.updateWikiPage({ subredditName, page: CONFIG_PAGE, content });
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
