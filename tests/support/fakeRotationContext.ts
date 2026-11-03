import type { RedisClient, Scheduler as DevvitScheduler, TriggerContext } from "@devvit/public-api";
import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ManagedComment, ManagedPost, RotationContext } from "../../src/rotation/index.js";

export interface FakeRedis {
    readonly del: Mock<RedisClient["del"]>;
    readonly get: Mock<RedisClient["get"]>;
    readonly hDel: Mock<RedisClient["hDel"]>;
    readonly hGet: Mock<RedisClient["hGet"]>;
    readonly hGetAll: Mock<RedisClient["hGetAll"]>;
    readonly hKeys: Mock<RedisClient["hKeys"]>;
    readonly hSet: Mock<RedisClient["hSet"]>;
    readonly set: Mock<RedisClient["set"]>;
}

export type CreateModInboxConversation = TriggerContext["reddit"]["modMail"]["createModInboxConversation"];

export interface FakeReddit {
    readonly modMail: Readonly<{ createModInboxConversation: Mock<CreateModInboxConversation> }>;
    readonly getCurrentSubredditName: Mock<() => Promise<string>>;
    readonly getPostById: Mock<RotationContext["reddit"]["getPostById"]>;
    readonly submitPost: Mock<RotationContext["reddit"]["submitPost"]>;
}

export interface FakeScheduler {
    readonly cancelJob: Mock<DevvitScheduler["cancelJob"]>;
    readonly listJobs: Mock<DevvitScheduler["listJobs"]>;
    readonly runJob: Mock<DevvitScheduler["runJob"]>;
}

export interface FakeRotationContext {
    readonly context: RotationContext;
    readonly redis: FakeRedis;
    readonly reddit: FakeReddit;
    readonly scheduler: FakeScheduler;
}

/** A RotationContext whose every dependency is a typed mock with an empty-store default. */
export function createFakeRotationContext(subredditName?: string): FakeRotationContext {
    const redis: FakeRedis = {
        del: vi.fn<RedisClient["del"]>().mockResolvedValue(undefined),
        get: vi.fn<RedisClient["get"]>().mockResolvedValue(undefined),
        hDel: vi.fn<RedisClient["hDel"]>().mockResolvedValue(0),
        hGet: vi.fn<RedisClient["hGet"]>().mockResolvedValue(undefined),
        hGetAll: vi.fn<RedisClient["hGetAll"]>().mockResolvedValue({}),
        hKeys: vi.fn<RedisClient["hKeys"]>().mockResolvedValue([]),
        hSet: vi.fn<RedisClient["hSet"]>().mockResolvedValue(0),
        set: vi.fn<RedisClient["set"]>().mockResolvedValue("OK"),
    };
    const reddit: FakeReddit = {
        modMail: {
            createModInboxConversation: vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id"),
        },
        getCurrentSubredditName: vi.fn<() => Promise<string>>().mockResolvedValue("currentsub"),
        getPostById: vi.fn<RotationContext["reddit"]["getPostById"]>(),
        submitPost: vi.fn<RotationContext["reddit"]["submitPost"]>(),
    };
    const scheduler: FakeScheduler = {
        cancelJob: vi.fn<DevvitScheduler["cancelJob"]>().mockResolvedValue(undefined),
        listJobs: vi.fn<DevvitScheduler["listJobs"]>().mockResolvedValue([]),
        runJob: vi.fn<DevvitScheduler["runJob"]>().mockResolvedValue("job-id"),
    };

    return {
        context: { redis, reddit, scheduler, subredditId: "t5_testsub", subredditName },
        redis,
        reddit,
        scheduler,
    };
}

export interface FakePost {
    readonly post: ManagedPost;
    readonly addComment: Mock<ManagedPost["addComment"]>;
    readonly commentDistinguish: Mock<ManagedComment["distinguish"]>;
    readonly distinguish: Mock<ManagedPost["distinguish"]>;
    readonly edit: Mock<ManagedPost["edit"]>;
    readonly lock: Mock<ManagedPost["lock"]>;
    readonly sticky: Mock<ManagedPost["sticky"]>;
    readonly unsticky: Mock<ManagedPost["unsticky"]>;
}

export type FakePostFields = Readonly<Pick<ManagedPost, "body" | "createdAt" | "id" | "numberOfComments" | "stickied">>;

/** A ManagedPost whose actions are typed mocks; a comment added to it resolves to a comment with its own mock. */
export function createFakePost(fields: FakePostFields): FakePost {
    const commentDistinguish = vi.fn<ManagedComment["distinguish"]>().mockResolvedValue(undefined);
    const addComment = vi.fn<ManagedPost["addComment"]>().mockResolvedValue({ distinguish: commentDistinguish });
    const distinguish = vi.fn<ManagedPost["distinguish"]>().mockResolvedValue(undefined);
    const edit = vi.fn<ManagedPost["edit"]>().mockResolvedValue(undefined);
    const lock = vi.fn<ManagedPost["lock"]>().mockResolvedValue(undefined);
    const sticky = vi.fn<ManagedPost["sticky"]>().mockResolvedValue(undefined);
    const unsticky = vi.fn<ManagedPost["unsticky"]>().mockResolvedValue(undefined);

    return {
        post: { ...fields, addComment, distinguish, edit, lock, sticky, unsticky },
        addComment,
        commentDistinguish,
        distinguish,
        edit,
        lock,
        sticky,
        unsticky,
    };
}
