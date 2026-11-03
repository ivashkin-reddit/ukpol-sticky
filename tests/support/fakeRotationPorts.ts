import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ThreadConfig } from "../../src/configuration/index.js";
import type { NotifyModerators } from "../../src/notifications/index.js";
import type {
    AppliedThreadConfigs,
    LivePosts,
    LoadThreadConfigs,
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
    readonly handovers: Mock<LivePosts["handovers"]>;
    readonly saveHandover: Mock<LivePosts["saveHandover"]>;
    readonly forgetHandover: Mock<LivePosts["forgetHandover"]>;
}

export interface FakeRotationPorts {
    readonly ports: RotationPorts;
    readonly appliedThreadConfigs: Readonly<{
        matches: Mock<AppliedThreadConfigs["matches"]>;
        record: Mock<AppliedThreadConfigs["record"]>;
    }>;
    readonly livePosts: FakeLivePosts;
    readonly notifyModerators: Mock<NotifyModerators>;
    readonly posts: Readonly<{
        get: Mock<Posts["get"]>;
        getComment: Mock<Posts["getComment"]>;
        publish: Mock<Posts["publish"]>;
    }>;
    readonly refreshFailureAlert: FakeAlertLatch;
    readonly refreshJobs: Readonly<{
        pendingRunTimes: Mock<RefreshJobs["pendingRunTimes"]>;
        replaceWith: Mock<RefreshJobs["replaceWith"]>;
        cancelAll: Mock<RefreshJobs["cancelAll"]>;
        hasHourlyCheck: Mock<RefreshJobs["hasHourlyCheck"]>;
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

/** Resolves to `value`: a fake live posts method's default, an empty store's answer. */
function resolving<Value>(value: Value): () => Promise<Value> {
    return async (): Promise<Value> => await Promise.resolve(value);
}

/** Live posts whose methods are typed mocks: `stored`'s implementations, or an empty store's answers. */
function createFakeLivePosts(stored: Partial<LivePosts>): FakeLivePosts {
    return {
        all: vi.fn<LivePosts["all"]>(stored.all ?? resolving({})),
        get: vi.fn<LivePosts["get"]>(stored.get ?? resolving(undefined)),
        configNames: vi.fn<LivePosts["configNames"]>(stored.configNames ?? resolving([])),
        set: vi.fn<LivePosts["set"]>(stored.set ?? resolving(undefined)),
        forget: vi.fn<LivePosts["forget"]>(stored.forget ?? resolving(undefined)),
        getCommentCap: vi.fn<LivePosts["getCommentCap"]>(stored.getCommentCap ?? resolving(undefined)),
        storeCommentCap: vi.fn<LivePosts["storeCommentCap"]>(stored.storeCommentCap ?? resolving(undefined)),
        forgetCommentCap: vi.fn<LivePosts["forgetCommentCap"]>(stored.forgetCommentCap ?? resolving(undefined)),
        handovers: vi.fn<LivePosts["handovers"]>(stored.handovers ?? resolving({})),
        saveHandover: vi.fn<LivePosts["saveHandover"]>(stored.saveHandover ?? resolving(undefined)),
        forgetHandover: vi.fn<LivePosts["forgetHandover"]>(stored.forgetHandover ?? resolving(undefined)),
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

/**
 * Applied thread configs that behave like the stored ones: thread configs match what was last recorded, compared as
 * JSON. They start with `configs` applied, as after a refresh.
 */
function createFakeAppliedThreadConfigs(configs: readonly ThreadConfig[]): FakeRotationPorts["appliedThreadConfigs"] {
    const applied = { json: JSON.stringify(configs) };
    return {
        matches: vi
            .fn<AppliedThreadConfigs["matches"]>()
            .mockImplementation(
                async (current: readonly ThreadConfig[]): Promise<boolean> =>
                    await Promise.resolve(JSON.stringify(current) === applied.json),
            ),
        record: vi
            .fn<AppliedThreadConfigs["record"]>()
            .mockImplementation(async (current: readonly ThreadConfig[]): Promise<void> => {
                applied.json = JSON.stringify(current);
                await Promise.resolve();
            }),
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

/** When the fakes' one pending refresh is due: later than any time a test runs at, so never overdue. */
export const PENDING_REFRESH_AT = new Date("2100-01-01T00:00:00Z");

/**
 * Rotation ports whose every method is a typed mock: no live posts (unless `livePosts` implements them), a refresh
 * pending and the hourly check scheduled, an alert latch that can be claimed, working thread locks, and `configs` as the
 * thread configs in force, already applied by a refresh.
 */
export function createFakeRotationPorts(
    configs: readonly ThreadConfig[] = [],
    livePosts: Partial<LivePosts> = {},
): FakeRotationPorts {
    const appliedThreadConfigs = createFakeAppliedThreadConfigs(configs);
    const fakeLivePosts = createFakeLivePosts(livePosts);
    const posts = {
        get: vi.fn<Posts["get"]>(),
        getComment: vi.fn<Posts["getComment"]>(),
        publish: vi.fn<Posts["publish"]>(),
    };
    const refreshJobs = {
        pendingRunTimes: vi.fn<RefreshJobs["pendingRunTimes"]>().mockResolvedValue([PENDING_REFRESH_AT]),
        replaceWith: vi.fn<RefreshJobs["replaceWith"]>().mockResolvedValue(undefined),
        cancelAll: vi.fn<RefreshJobs["cancelAll"]>().mockResolvedValue(undefined),
        hasHourlyCheck: vi.fn<RefreshJobs["hasHourlyCheck"]>().mockResolvedValue(true),
        startHourlyCheck: vi.fn<RefreshJobs["startHourlyCheck"]>().mockResolvedValue(undefined),
    };
    const notifyModerators = vi.fn<NotifyModerators>().mockResolvedValue(undefined);
    const refreshStatus = createFakeRefreshStatus();
    const refreshFailureAlert = createFakeAlertLatch();
    const threadConfigs = vi.fn<LoadThreadConfigs>().mockResolvedValue(configs);
    const threadLocks = createFakeThreadLocks();

    return {
        ports: {
            appliedThreadConfigs,
            livePosts: fakeLivePosts,
            notifyModerators,
            posts,
            refreshFailureAlert: refreshFailureAlert.latch,
            refreshJobs,
            refreshStatus,
            threadConfigs,
            threadLocks,
        },
        appliedThreadConfigs,
        livePosts: fakeLivePosts,
        notifyModerators,
        posts,
        refreshFailureAlert,
        refreshJobs,
        refreshStatus,
        threadConfigs,
        threadLocks,
    };
}
