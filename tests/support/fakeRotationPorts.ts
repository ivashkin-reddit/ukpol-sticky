import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ThreadConfig } from "../../src/configuration/index.js";
import type { Highlight } from "../../src/highlights/index.js";
import type { AlertLatch, NotifyModerators } from "../../src/notifications/index.js";
import type {
    AppliedThreadConfigs,
    LivePosts,
    LoadThreadConfigs,
    PendingRefresh,
    Posts,
    RefreshJobs,
    RefreshStatusStore,
    RetiredRefreshRecords,
    RotationPorts,
} from "../../src/rotation/index.js";
import { createFakeAlertLatch } from "./fakeAlertLatch.js";
import type { FakeAlertLatch } from "./fakeAlertLatch.js";
import { createFakeHighlights } from "./fakeHighlights.js";
import type { FakeHighlights } from "./fakeHighlights.js";
import { createFakeThreadFailureAlerts, createFakeThreadLocks } from "./fakeThreadLocks.js";
import type { FakeThreadLocks } from "./fakeThreadLocks.js";
import type { CalledMock, Writes } from "./writes.js";

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
        read: Mock<AppliedThreadConfigs["read"]>;
        record: Mock<AppliedThreadConfigs["record"]>;
        configNames: Mock<AppliedThreadConfigs["configNames"]>;
        forget: Mock<AppliedThreadConfigs["forget"]>;
    }>;
    readonly highlights: FakeHighlights;
    readonly livePosts: FakeLivePosts;
    readonly notifyModerators: Mock<NotifyModerators>;
    readonly posts: Readonly<{
        get: Mock<Posts["get"]>;
        getComment: Mock<Posts["getComment"]>;
        publish: Mock<Posts["publish"]>;
    }>;
    readonly refreshFailureAlert: FakeAlertLatch;
    readonly refreshJobs: Readonly<{
        pending: Mock<RefreshJobs["pending"]>;
        replaceFor: Mock<RefreshJobs["replaceFor"]>;
        cancelFor: Mock<RefreshJobs["cancelFor"]>;
        cancelUnassigned: Mock<RefreshJobs["cancelUnassigned"]>;
        hasHourlyCheck: Mock<RefreshJobs["hasHourlyCheck"]>;
        startHourlyCheck: Mock<RefreshJobs["startHourlyCheck"]>;
    }>;
    readonly refreshStatus: Readonly<{
        read: Mock<RefreshStatusStore["read"]>;
        recordSuccess: Mock<RefreshStatusStore["recordSuccess"]>;
        recordFailure: Mock<RefreshStatusStore["recordFailure"]>;
        recordNextRefresh: Mock<RefreshStatusStore["recordNextRefresh"]>;
        forget: Mock<RefreshStatusStore["forget"]>;
    }>;
    readonly retiredRefreshRecords: Readonly<{
        readAppliedThreadConfigs: Mock<RetiredRefreshRecords["readAppliedThreadConfigs"]>;
        delete: Mock<RetiredRefreshRecords["delete"]>;
    }>;
    readonly threadConfigs: Mock<LoadThreadConfigs>;
    /** The latch of the alert about the named thread config's failed refreshes, the same one each time. */
    readonly threadFailureAlert: (configName: string) => FakeAlertLatch;
    readonly threadLocks: FakeThreadLocks;
    /** Every method that writes, schedules, posts, sends or locks, for checking that a use case only reads. */
    readonly writes: Writes;
}

/** The writing methods of a set of rotation fakes, as far as their calls go. */
type RotationWriteMethods = Readonly<{
    appliedThreadConfigs: Readonly<Record<"forget" | "record", CalledMock>>;
    highlights: Readonly<Record<"pin" | "reorder" | "unpin", CalledMock>>;
    livePosts: Readonly<
        Record<
            "forget" | "forgetCommentCap" | "forgetHandover" | "saveHandover" | "set" | "storeCommentCap",
            CalledMock
        >
    >;
    notifyModerators: CalledMock;
    posts: Readonly<Record<"publish", CalledMock>>;
    refreshFailureAlert: Readonly<Record<"claim", CalledMock>>;
    refreshJobs: Readonly<Record<"cancelFor" | "cancelUnassigned" | "replaceFor" | "startHourlyCheck", CalledMock>>;
    refreshStatus: Readonly<Record<"forget" | "recordFailure" | "recordNextRefresh" | "recordSuccess", CalledMock>>;
    retiredRefreshRecords: Readonly<Record<"delete", CalledMock>>;
    threadLocks: Readonly<Record<"tryLock", CalledMock>>;
}>;

/** The writing methods of `fakes`, by name. */
function listWrites(fakes: RotationWriteMethods): Writes {
    return {
        "appliedThreadConfigs.record": fakes.appliedThreadConfigs.record,
        "appliedThreadConfigs.forget": fakes.appliedThreadConfigs.forget,
        "highlights.pin": fakes.highlights.pin,
        "highlights.unpin": fakes.highlights.unpin,
        "highlights.reorder": fakes.highlights.reorder,
        "livePosts.set": fakes.livePosts.set,
        "livePosts.forget": fakes.livePosts.forget,
        "livePosts.saveHandover": fakes.livePosts.saveHandover,
        "livePosts.forgetHandover": fakes.livePosts.forgetHandover,
        "livePosts.storeCommentCap": fakes.livePosts.storeCommentCap,
        "livePosts.forgetCommentCap": fakes.livePosts.forgetCommentCap,
        "notifyModerators": fakes.notifyModerators,
        "posts.publish": fakes.posts.publish,
        "refreshFailureAlert.claim": fakes.refreshFailureAlert.claim,
        "refreshJobs.replaceFor": fakes.refreshJobs.replaceFor,
        "refreshJobs.cancelFor": fakes.refreshJobs.cancelFor,
        "refreshJobs.cancelUnassigned": fakes.refreshJobs.cancelUnassigned,
        "refreshJobs.startHourlyCheck": fakes.refreshJobs.startHourlyCheck,
        "refreshStatus.recordSuccess": fakes.refreshStatus.recordSuccess,
        "refreshStatus.recordFailure": fakes.refreshStatus.recordFailure,
        "refreshStatus.recordNextRefresh": fakes.refreshStatus.recordNextRefresh,
        "refreshStatus.forget": fakes.refreshStatus.forget,
        "retiredRefreshRecords.delete": fakes.retiredRefreshRecords.delete,
        "threadLocks.tryLock": fakes.threadLocks.tryLock,
    };
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
        read: vi.fn<RefreshStatusStore["read"]>().mockResolvedValue({}),
        recordSuccess: vi.fn<RefreshStatusStore["recordSuccess"]>().mockResolvedValue(undefined),
        recordFailure: vi.fn<RefreshStatusStore["recordFailure"]>().mockResolvedValue(undefined),
        recordNextRefresh: vi.fn<RefreshStatusStore["recordNextRefresh"]>().mockResolvedValue(undefined),
        forget: vi.fn<RefreshStatusStore["forget"]>().mockResolvedValue(undefined),
    };
}

/**
 * Applied thread configs that behave like the stored ones: a thread config matches the version last recorded under its
 * name, compared as JSON, and reads back as it. Each of `configs` that is enabled starts applied, as after its refresh.
 */
function createFakeAppliedThreadConfigs(configs: readonly ThreadConfig[]): FakeRotationPorts["appliedThreadConfigs"] {
    const applied = new Map(
        configs
            .filter((config): boolean => config.enabled)
            .map((config): readonly [string, ThreadConfig] => [config.name, config]),
    );
    return {
        matches: vi
            .fn<AppliedThreadConfigs["matches"]>()
            .mockImplementation(
                async (config: ThreadConfig): Promise<boolean> =>
                    await Promise.resolve(JSON.stringify(applied.get(config.name)) === JSON.stringify(config)),
            ),
        read: vi
            .fn<AppliedThreadConfigs["read"]>()
            .mockImplementation(
                async (configName: string): Promise<ThreadConfig | undefined> =>
                    await Promise.resolve(applied.get(configName)),
            ),
        record: vi
            .fn<AppliedThreadConfigs["record"]>()
            .mockImplementation(async (config: ThreadConfig): Promise<void> => {
                applied.set(config.name, config);
                await Promise.resolve();
            }),
        configNames: vi
            .fn<AppliedThreadConfigs["configNames"]>()
            .mockImplementation(async (): Promise<readonly string[]> => await Promise.resolve([...applied.keys()])),
        forget: vi
            .fn<AppliedThreadConfigs["forget"]>()
            .mockImplementation(async (configNames: readonly string[]): Promise<void> => {
                for (const configName of configNames) {
                    applied.delete(configName);
                }

                await Promise.resolve();
            }),
    };
}

/** Posts with no answers of their own: each test sets what it reads and publishes. */
function createFakePosts(): FakeRotationPorts["posts"] {
    return {
        get: vi.fn<Posts["get"]>(),
        getComment: vi.fn<Posts["getComment"]>(),
        publish: vi.fn<Posts["publish"]>(),
    };
}

/** When each fake pending refresh is due: later than any time a test runs at, so never overdue. */
export const PENDING_REFRESH_AT = new Date("2100-01-01T00:00:00Z");

function createFakeRefreshJobs(configs: readonly ThreadConfig[]): FakeRotationPorts["refreshJobs"] {
    const pending = configs
        .filter((config): boolean => config.enabled)
        .map((config): PendingRefresh => ({ configName: config.name, runAt: PENDING_REFRESH_AT }));
    return {
        pending: vi.fn<RefreshJobs["pending"]>().mockResolvedValue(pending),
        replaceFor: vi.fn<RefreshJobs["replaceFor"]>().mockResolvedValue(undefined),
        cancelFor: vi.fn<RefreshJobs["cancelFor"]>().mockResolvedValue(undefined),
        cancelUnassigned: vi.fn<RefreshJobs["cancelUnassigned"]>().mockResolvedValue(undefined),
        hasHourlyCheck: vi.fn<RefreshJobs["hasHourlyCheck"]>().mockResolvedValue(true),
        startHourlyCheck: vi.fn<RefreshJobs["startHourlyCheck"]>().mockResolvedValue(undefined),
    };
}

/**
 * Rotation ports whose every method is a typed mock: no live posts (unless `livePosts` implements them), a refresh of
 * each enabled thread config pending and the hourly check scheduled, alert latches that can be claimed, working thread
 * locks, `configs` as the thread configs in force, each enabled one already applied by its refresh, and `highlights`
 * as the subreddit's highlights, which behave as Reddit's.
 */
export function createFakeRotationPorts(
    configs: readonly ThreadConfig[] = [],
    livePosts: Partial<LivePosts> = {},
    highlights: readonly Highlight[] = [],
): FakeRotationPorts {
    const fakes: Omit<FakeRotationPorts, "ports" | "writes"> = {
        appliedThreadConfigs: createFakeAppliedThreadConfigs(configs),
        highlights: createFakeHighlights(highlights),
        livePosts: createFakeLivePosts(livePosts),
        notifyModerators: vi.fn<NotifyModerators>().mockResolvedValue(undefined),
        posts: createFakePosts(),
        refreshFailureAlert: createFakeAlertLatch(),
        refreshJobs: createFakeRefreshJobs(configs),
        refreshStatus: createFakeRefreshStatus(),
        retiredRefreshRecords: {
            readAppliedThreadConfigs: vi
                .fn<RetiredRefreshRecords["readAppliedThreadConfigs"]>()
                .mockResolvedValue(undefined),
            delete: vi.fn<RetiredRefreshRecords["delete"]>().mockResolvedValue(undefined),
        },
        threadConfigs: vi.fn<LoadThreadConfigs>().mockResolvedValue(configs),
        threadFailureAlert: createFakeThreadFailureAlerts(),
        threadLocks: createFakeThreadLocks(),
    };

    return {
        ports: {
            appliedThreadConfigs: fakes.appliedThreadConfigs,
            highlights: fakes.highlights.highlights,
            livePosts: fakes.livePosts,
            notifyModerators: fakes.notifyModerators,
            posts: fakes.posts,
            refreshFailureAlert: fakes.refreshFailureAlert.latch,
            refreshJobs: fakes.refreshJobs,
            refreshStatus: fakes.refreshStatus,
            retiredRefreshRecords: fakes.retiredRefreshRecords,
            threadConfigs: fakes.threadConfigs,
            threadFailureAlert: (configName: string): AlertLatch => fakes.threadFailureAlert(configName).latch,
            threadLocks: fakes.threadLocks,
        },
        ...fakes,
        writes: listWrites(fakes),
    };
}
