import type { RedisClient, Scheduler as DevvitScheduler } from "@devvit/public-api";
import type { ScheduledJob } from "@devvit/scheduler";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type { WikiUpdateContext, WikiUpdateEvent } from "../../src/wikiConfig.js";
import type { CreateModInboxConversation } from "./fakeStickyContext.js";

export const WIKI_REVISION_EVENT: WikiUpdateEvent = { action: "wikirevise", moderator: { name: "mod_user" } };

export const VALID_WIKI_CONTENT = [
    "name: daily-thread",
    "enabled: true",
    "title: Daily thread",
    "frequency: daily",
    'postTime: "12:30"',
    "sticky: true",
    "maxComments: 200",
    "body: |",
    "  Hello world",
].join("\n");

export interface WikiFakes {
    readonly context: WikiUpdateContext;
    readonly cancelJob: Mock<DevvitScheduler["cancelJob"]>;
    readonly createModInboxConversation: Mock<CreateModInboxConversation>;
    readonly getWikiPage: Mock<WikiUpdateContext["reddit"]["getWikiPage"]>;
    readonly redisDel: Mock<RedisClient["del"]>;
    readonly redisGet: Mock<RedisClient["get"]>;
    readonly redisSet: Mock<RedisClient["set"]>;
    readonly runJob: Mock<DevvitScheduler["runJob"]>;
}

export type WikiFakeOptions = Readonly<{
    lastRevision?: string;
    scheduledJobs?: readonly Readonly<{ id: string; name: string }>[];
    wikiContent?: string;
    wikiError?: Readonly<Error>;
}>;

/** Resolves to revision "rev-2" of the given content, or rejects with `wikiError` when one is given. */
function fakeGetWikiPage(options: WikiFakeOptions): Mock<WikiUpdateContext["reddit"]["getWikiPage"]> {
    const getWikiPage = vi.fn<WikiUpdateContext["reddit"]["getWikiPage"]>();
    if (options.wikiError === undefined) {
        return getWikiPage.mockResolvedValue({
            content: options.wikiContent ?? VALID_WIKI_CONTENT,
            revisionId: "rev-2",
        });
    }

    return getWikiPage.mockRejectedValue(options.wikiError);
}

export function createWikiFakes(options: WikiFakeOptions = {}): WikiFakes {
    const getWikiPage = fakeGetWikiPage(options);
    const redisDel = vi.fn<RedisClient["del"]>().mockResolvedValue(undefined);
    const redisGet = vi.fn<RedisClient["get"]>().mockResolvedValue(options.lastRevision);
    const redisSet = vi.fn<RedisClient["set"]>().mockResolvedValue("OK");
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");
    const cancelJob = vi.fn<DevvitScheduler["cancelJob"]>().mockResolvedValue(undefined);
    const listJobs = vi.fn<DevvitScheduler["listJobs"]>().mockResolvedValue(
        (options.scheduledJobs ?? []).map((job: Readonly<{ id: string; name: string }>): ScheduledJob => ({
            ...job,
            data: undefined,
            runAt: new Date("2026-04-22T00:00:00Z"),
        })),
    );
    const runJob = vi.fn<DevvitScheduler["runJob"]>().mockResolvedValue("job-id");

    return {
        context: {
            redis: { del: redisDel, get: redisGet, set: redisSet },
            reddit: {
                getCurrentSubredditName: vi.fn<() => Promise<string>>().mockResolvedValue("currentsub"),
                getWikiPage,
                modMail: { createModInboxConversation },
            },
            scheduler: { cancelJob, listJobs, runJob },
            subredditId: "t5_testsub",
            subredditName: "testsub",
        },
        cancelJob,
        createModInboxConversation,
        getWikiPage,
        redisDel,
        redisGet,
        redisSet,
        runJob,
    };
}
