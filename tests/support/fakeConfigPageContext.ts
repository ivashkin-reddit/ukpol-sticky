import type { RedisClient } from "@devvit/public-api";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ConfigPageRevisionContext } from "../../src/configuration/index.js";
import type { CreateModInboxConversation } from "./fakeRotationContext.js";

export const VALID_CONFIG_PAGE = [
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

type GetWikiPage = ConfigPageRevisionContext["reddit"]["getWikiPage"];

export interface ConfigPageFakes {
    readonly context: ConfigPageRevisionContext;
    readonly createModInboxConversation: Mock<CreateModInboxConversation>;
    readonly getWikiPage: Mock<GetWikiPage>;
    readonly redisDel: Mock<RedisClient["del"]>;
    readonly redisGet: Mock<RedisClient["get"]>;
    readonly redisSet: Mock<RedisClient["set"]>;
}

export type ConfigPageFakeOptions = Readonly<{
    lastRevision?: string;
    pageContent?: string;
    pageError?: Readonly<Error>;
}>;

/** Resolves to revision "rev-2" of the given content, or rejects with `pageError` when one is given. */
function fakeGetWikiPage(options: ConfigPageFakeOptions): Mock<GetWikiPage> {
    const getWikiPage = vi.fn<GetWikiPage>();
    if (options.pageError === undefined) {
        return getWikiPage.mockResolvedValue({
            content: options.pageContent ?? VALID_CONFIG_PAGE,
            revisionId: "rev-2",
        });
    }

    return getWikiPage.mockRejectedValue(options.pageError);
}

/** A ConfigPageRevisionContext whose every dependency is a typed mock. */
export function createConfigPageFakes(options: ConfigPageFakeOptions = {}): ConfigPageFakes {
    const getWikiPage = fakeGetWikiPage(options);
    const redisDel = vi.fn<RedisClient["del"]>().mockResolvedValue(undefined);
    const redisGet = vi.fn<RedisClient["get"]>().mockResolvedValue(options.lastRevision);
    const redisSet = vi.fn<RedisClient["set"]>().mockResolvedValue("OK");
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");

    return {
        context: {
            redis: { del: redisDel, get: redisGet, set: redisSet },
            reddit: {
                getCurrentSubredditName: vi.fn<() => Promise<string>>().mockResolvedValue("currentsub"),
                getWikiPage,
                modMail: { createModInboxConversation },
            },
            subredditId: "t5_testsub",
            subredditName: "testsub",
        },
        createModInboxConversation,
        getWikiPage,
        redisDel,
        redisGet,
        redisSet,
    };
}
