import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ThreadConfig } from "../../src/configuration/index.js";
import type { NotifyModerators } from "../../src/notifications/index.js";
import type {
    LivePosts,
    LoadThreadConfigs,
    ManagedComment,
    ManagedPost,
    Posts,
    RefreshJobs,
    RefreshStatusStore,
    RotationPorts,
    ThreadLocks,
} from "../../src/rotation/index.js";
import { createFakeAlertLatch } from "./fakeAlertLatch.js";
import type { FakeAlertLatch } from "./fakeAlertLatch.js";

export interface FakeLivePosts {
    readonly all: Mock<LivePosts["all"]>;
    readonly get: Mock<LivePosts["get"]>;
    readonly configNames: Mock<LivePosts["configNames"]>;
    readonly set: Mock<LivePosts["set"]>;
    readonly forget: Mock<LivePosts["forget"]>;
    readonly getCommentCap: Mock<LivePosts["getCommentCap"]>;
    readonly storeCommentCap: Mock<LivePosts["storeCommentCap"]>;
    readonly forgetCommentCap: Mock<LivePosts["forgetCommentCap"]>;
}

export interface FakeRotationPorts {
    readonly ports: RotationPorts;
    readonly livePosts: FakeLivePosts;
    readonly notifyModerators: Mock<NotifyModerators>;
    readonly posts: Readonly<{ get: Mock<Posts["get"]>; publish: Mock<Posts["publish"]> }>;
    readonly refreshFailureAlert: FakeAlertLatch;
    readonly refreshJobs: Readonly<{
        cancelAll: Mock<RefreshJobs["cancelAll"]>;
        scheduleAt: Mock<RefreshJobs["scheduleAt"]>;
        isPending: Mock<RefreshJobs["isPending"]>;
        startHourlyCheck: Mock<RefreshJobs["startHourlyCheck"]>;
    }>;
    readonly refreshStatus: Readonly<{
        read: Mock<RefreshStatusStore["read"]>;
        recordSuccess: Mock<RefreshStatusStore["recordSuccess"]>;
        recordFailure: Mock<RefreshStatusStore["recordFailure"]>;
        recordNextRefresh: Mock<RefreshStatusStore["recordNextRefresh"]>;
    }>;
    readonly threadConfigs: Mock<LoadThreadConfigs>;
    readonly threadLocks: Readonly<{ tryLock: Mock<ThreadLocks["tryLock"]>; unlock: Mock<ThreadLocks["unlock"]> }>;
}

function createFakeLivePosts(): FakeLivePosts {
    return {
        all: vi.fn<LivePosts["all"]>().mockResolvedValue({}),
        get: vi.fn<LivePosts["get"]>().mockResolvedValue(undefined),
        configNames: vi.fn<LivePosts["configNames"]>().mockResolvedValue([]),
        set: vi.fn<LivePosts["set"]>().mockResolvedValue(undefined),
        forget: vi.fn<LivePosts["forget"]>().mockResolvedValue(undefined),
        getCommentCap: vi.fn<LivePosts["getCommentCap"]>().mockResolvedValue(undefined),
        storeCommentCap: vi.fn<LivePosts["storeCommentCap"]>().mockResolvedValue(undefined),
        forgetCommentCap: vi.fn<LivePosts["forgetCommentCap"]>().mockResolvedValue(undefined),
    };
}

function createFakeRefreshStatus(): FakeRotationPorts["refreshStatus"] {
    return {
        read: vi.fn<RefreshStatusStore["read"]>().mockResolvedValue({
            lastRefresh: undefined,
            lastSuccessAt: undefined,
            nextRefreshAt: undefined,
        }),
        recordSuccess: vi.fn<RefreshStatusStore["recordSuccess"]>().mockResolvedValue(undefined),
        recordFailure: vi.fn<RefreshStatusStore["recordFailure"]>().mockResolvedValue(undefined),
        recordNextRefresh: vi.fn<RefreshStatusStore["recordNextRefresh"]>().mockResolvedValue(undefined),
    };
}

/** Thread locks that behave like the real ones: one holder per thread config until it unlocks. */
function createFakeThreadLocks(): FakeRotationPorts["threadLocks"] {
    const held = new Set<string>();
    return {
        tryLock: vi.fn<ThreadLocks["tryLock"]>().mockImplementation(async (configName: string): Promise<boolean> => {
            const free = !held.has(configName);
            held.add(configName);
            return await Promise.resolve(free);
        }),
        unlock: vi.fn<ThreadLocks["unlock"]>().mockImplementation(async (configName: string): Promise<void> => {
            held.delete(configName);
            await Promise.resolve();
        }),
    };
}

/**
 * Rotation ports whose every method is a typed mock: no live posts, a refresh pending, an alert latch that can be
 * claimed, working thread locks, and `configs` as the thread configs in force.
 */
export function createFakeRotationPorts(configs: readonly ThreadConfig[] = []): FakeRotationPorts {
    const livePosts = createFakeLivePosts();
    const posts = { get: vi.fn<Posts["get"]>(), publish: vi.fn<Posts["publish"]>() };
    const refreshJobs = {
        cancelAll: vi.fn<RefreshJobs["cancelAll"]>().mockResolvedValue(undefined),
        scheduleAt: vi.fn<RefreshJobs["scheduleAt"]>().mockResolvedValue(undefined),
        isPending: vi.fn<RefreshJobs["isPending"]>().mockResolvedValue(true),
        startHourlyCheck: vi.fn<RefreshJobs["startHourlyCheck"]>().mockResolvedValue(undefined),
    };
    const notifyModerators = vi.fn<NotifyModerators>().mockResolvedValue(undefined);
    const refreshStatus = createFakeRefreshStatus();
    const refreshFailureAlert = createFakeAlertLatch();
    const threadConfigs = vi.fn<LoadThreadConfigs>().mockResolvedValue(configs);
    const threadLocks = createFakeThreadLocks();

    return {
        ports: {
            livePosts,
            notifyModerators,
            posts,
            refreshFailureAlert: refreshFailureAlert.latch,
            refreshJobs,
            refreshStatus,
            threadConfigs,
            threadLocks,
        },
        livePosts,
        notifyModerators,
        posts,
        refreshFailureAlert,
        refreshJobs,
        refreshStatus,
        threadConfigs,
        threadLocks,
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
