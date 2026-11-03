import { reddit, redis, scheduler } from "@devvit/web/server";
import type { T1, T3 } from "@devvit/web/shared";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type { DevvitContext } from "../../src/composition.js";
import type { ManagedComment, ManagedPost } from "../../src/rotation/index.js";
import { createApp } from "../../src/server/app.js";
import { TEST_APP_SLUG, TEST_SUBREDDIT_ID, TEST_SUBREDDIT_NAME } from "./devvitHarness.js";
import type { CreateModInboxConversation } from "./fakeDevvitContext.js";

type DevvitReddit = DevvitContext["reddit"];

type WikiRevision = Awaited<ReturnType<DevvitReddit["getWikiPage"]>>;

type Wiki = Pick<DevvitReddit, "getWikiPage" | "getWikiPages" | "updateWikiPage" | "updateWikiPageSettings">;

export interface HarnessWorld {
    readonly context: DevvitContext;
    readonly createModInboxConversation: Mock<CreateModInboxConversation>;
    /** Every post the app publishes, passed through to the harness. */
    readonly submitPost: Mock<DevvitReddit["submitPost"]>;
    /** Delivers `body` to the app's route at `path` twice, as Devvit may, and returns both response statuses. */
    readonly deliverTwice: (path: string, body: Readonly<Record<string, unknown>>) => Promise<readonly number[]>;
}

/**
 * A stand-in for the subreddit wiki, which the harness does not implement: one config page that starts with
 * `wikiContent` (absent when undefined) and keeps what is written to it, each write a new revision.
 */
function createWiki(wikiContent: string | undefined): Wiki {
    const page = { content: wikiContent, revision: wikiContent === undefined ? 0 : 1 };
    return {
        getWikiPage: async (): Promise<WikiRevision> => {
            if (page.content === undefined) {
                throw new Error("The wiki page does not exist.");
            }

            return await Promise.resolve({
                content: page.content,
                revisionId: `rev-${String(page.revision)}`,
                revisionAuthor: { username: "mod_user" },
            });
        },
        getWikiPages: async (): Promise<readonly string[]> =>
            await Promise.resolve(page.content === undefined ? [] : ["stickymgr/config"]),
        updateWikiPage: async (options: Parameters<DevvitReddit["updateWikiPage"]>[0]): Promise<unknown> => {
            page.content = options.content;
            page.revision += 1;
            await Promise.resolve();
            return page.revision;
        },
        updateWikiPageSettings: async (): Promise<unknown> => {
            await Promise.resolve();
            return page.revision;
        },
    };
}

/**
 * The harness's Reddit, Redis and scheduler as a request receives them, with stand-ins for the two Reddit APIs the
 * harness does not implement: the wiki (see createWiki) and modmail, a mock.
 */
export function createHarnessWorld(wikiContent: string | undefined): HarnessWorld {
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");
    const submitPost = vi
        .fn<DevvitReddit["submitPost"]>()
        .mockImplementation(
            async (options: Parameters<DevvitReddit["submitPost"]>[0]): Promise<ManagedPost> =>
                await reddit.submitPost(options),
        );
    const context: DevvitContext = {
        appSlug: TEST_APP_SLUG,
        reddit: {
            modMail: { createModInboxConversation },
            getCommentById: async (id: T1): Promise<ManagedComment> => await reddit.getCommentById(id),
            getPostById: async (id: T3): Promise<ManagedPost> => await reddit.getPostById(id),
            submitPost,
            ...createWiki(wikiContent),
        },
        redis,
        scheduler,
        subredditId: TEST_SUBREDDIT_ID,
        subredditName: TEST_SUBREDDIT_NAME,
    };

    return {
        context,
        createModInboxConversation,
        submitPost,
        deliverTwice: async (path: string, body: Readonly<Record<string, unknown>>): Promise<readonly number[]> => {
            const app = createApp((): DevvitContext => context);
            const init = { method: "POST", body: JSON.stringify(body) };
            const first = await app.request(path, init);
            const second = await app.request(path, init);
            return [first.status, second.status];
        },
    };
}
