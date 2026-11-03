import type { RedisClient, Scheduler as DevvitScheduler, TriggerContext } from "@devvit/public-api";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ConfigurationContext, RotationContext } from "../../src/composition.js";
import type { LockReleaseTransaction, ThreadLocksRedis } from "../../src/rotation/adapters/redisThreadLocks.js";

export interface FakeTransaction {
    readonly transaction: LockReleaseTransaction;
    readonly multi: Mock<LockReleaseTransaction["multi"]>;
    readonly del: Mock<LockReleaseTransaction["del"]>;
    readonly exec: Mock<LockReleaseTransaction["exec"]>;
    readonly unwatch: Mock<LockReleaseTransaction["unwatch"]>;
}

export interface FakeRedis {
    readonly del: Mock<RedisClient["del"]>;
    readonly get: Mock<RedisClient["get"]>;
    readonly hDel: Mock<RedisClient["hDel"]>;
    readonly hGet: Mock<RedisClient["hGet"]>;
    readonly hGetAll: Mock<RedisClient["hGetAll"]>;
    readonly hKeys: Mock<RedisClient["hKeys"]>;
    readonly hSet: Mock<RedisClient["hSet"]>;
    readonly set: Mock<RedisClient["set"]>;
    readonly watch: Mock<ThreadLocksRedis["watch"]>;
    /** The transaction every `watch` call returns. */
    readonly transaction: FakeTransaction;
}

export type CreateModInboxConversation = TriggerContext["reddit"]["modMail"]["createModInboxConversation"];

type DevvitReddit = ConfigurationContext["reddit"] & RotationContext["reddit"];

export interface FakeReddit {
    readonly modMail: Readonly<{ createModInboxConversation: Mock<CreateModInboxConversation> }>;
    readonly getCurrentSubredditName: Mock<() => Promise<string>>;
    readonly getCommentById: Mock<DevvitReddit["getCommentById"]>;
    readonly getPostById: Mock<DevvitReddit["getPostById"]>;
    readonly getWikiPage: Mock<DevvitReddit["getWikiPage"]>;
    readonly getWikiPages: Mock<DevvitReddit["getWikiPages"]>;
    readonly submitPost: Mock<DevvitReddit["submitPost"]>;
    readonly updateWikiPage: Mock<DevvitReddit["updateWikiPage"]>;
    readonly updateWikiPageSettings: Mock<DevvitReddit["updateWikiPageSettings"]>;
}

export interface FakeScheduler {
    readonly cancelJob: Mock<DevvitScheduler["cancelJob"]>;
    readonly listJobs: Mock<DevvitScheduler["listJobs"]>;
    readonly runJob: Mock<DevvitScheduler["runJob"]>;
}

/** The Devvit context every handler receives, as the composition root's context types describe it. */
export type DevvitContext = ConfigurationContext & RotationContext & Readonly<{ appSlug: string }>;

export interface FakeDevvitContext {
    readonly context: DevvitContext;
    readonly redis: FakeRedis;
    readonly reddit: FakeReddit;
    readonly scheduler: FakeScheduler;
}

function createFakeReddit(): FakeReddit {
    return {
        modMail: {
            createModInboxConversation: vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id"),
        },
        getCurrentSubredditName: vi.fn<() => Promise<string>>().mockResolvedValue("currentsub"),
        getCommentById: vi.fn<DevvitReddit["getCommentById"]>(),
        getPostById: vi.fn<DevvitReddit["getPostById"]>(),
        getWikiPage: vi.fn<DevvitReddit["getWikiPage"]>(),
        getWikiPages: vi.fn<DevvitReddit["getWikiPages"]>().mockResolvedValue([]),
        submitPost: vi.fn<DevvitReddit["submitPost"]>(),
        updateWikiPage: vi.fn<DevvitReddit["updateWikiPage"]>().mockResolvedValue(undefined),
        updateWikiPageSettings: vi.fn<DevvitReddit["updateWikiPageSettings"]>().mockResolvedValue(undefined),
    };
}

function createFakeTransaction(): FakeTransaction {
    const multi = vi.fn<LockReleaseTransaction["multi"]>().mockResolvedValue(undefined);
    const del = vi.fn<LockReleaseTransaction["del"]>().mockResolvedValue(undefined);
    const exec = vi.fn<LockReleaseTransaction["exec"]>().mockResolvedValue([]);
    const unwatch = vi.fn<LockReleaseTransaction["unwatch"]>().mockResolvedValue(undefined);
    return { transaction: { multi, del, exec, unwatch }, multi, del, exec, unwatch };
}

/** A Devvit context whose every dependency is a typed mock with an empty-store default. */
export function createFakeDevvitContext(subredditName?: string): FakeDevvitContext {
    const transaction = createFakeTransaction();
    const redis: FakeRedis = {
        del: vi.fn<RedisClient["del"]>().mockResolvedValue(undefined),
        get: vi.fn<RedisClient["get"]>().mockResolvedValue(undefined),
        hDel: vi.fn<RedisClient["hDel"]>().mockResolvedValue(0),
        hGet: vi.fn<RedisClient["hGet"]>().mockResolvedValue(undefined),
        hGetAll: vi.fn<RedisClient["hGetAll"]>().mockResolvedValue({}),
        hKeys: vi.fn<RedisClient["hKeys"]>().mockResolvedValue([]),
        hSet: vi.fn<RedisClient["hSet"]>().mockResolvedValue(0),
        set: vi.fn<RedisClient["set"]>().mockResolvedValue("OK"),
        watch: vi.fn<ThreadLocksRedis["watch"]>().mockResolvedValue(transaction.transaction),
        transaction,
    };
    const reddit = createFakeReddit();
    const scheduler: FakeScheduler = {
        cancelJob: vi.fn<DevvitScheduler["cancelJob"]>().mockResolvedValue(undefined),
        listJobs: vi.fn<DevvitScheduler["listJobs"]>().mockResolvedValue([]),
        runJob: vi.fn<DevvitScheduler["runJob"]>().mockResolvedValue("job-id"),
    };

    return {
        context: { appSlug: "ukpol-sticky", redis, reddit, scheduler, subredditId: "t5_testsub", subredditName },
        redis,
        reddit,
        scheduler,
    };
}
