import { getSchedule } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { findAttentionReasons, putFirst } from "./domain/statusRules.js";
import type { AttentionReason } from "./domain/statusRules.js";
import type { Handover, PendingRefresh, RefreshStatus, RotationPorts } from "./ports.js";
import { inRefreshOrder } from "./threadConfigOrder.js";

export type StatusPorts = Pick<
    RotationPorts,
    "appliedThreadConfigs" | "livePosts" | "posts" | "refreshJobs" | "refreshStatus"
>;

/** A thread config's live post as the status shows it. */
export type LivePostStatus =
    | Readonly<{
          kind: "readable";
          id: string;
          title: string;
          createdAt: Date;
          comments: number;
          /** The comment cap stored for the post, the one rotation enforces; undefined when none is stored. */
          commentCap: number | undefined;
      }>
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "unreadable"; postId: string }>;

/** A thread config in force whose status was read. */
export interface ReadableThreadStatus {
    readonly kind: "readable";
    readonly configName: string;
    readonly hasSchedule: boolean;
    readonly livePost: LivePostStatus;
    readonly refreshStatus: RefreshStatus;
    /** Its unfinished handover, if one is unfinished. */
    readonly handover: Handover | undefined;
    /** Why it needs attention; empty when it does not. */
    readonly attention: readonly AttentionReason[];
}

/** A thread config in force, as the status shows it: its status, or that its status could not be read. */
export type ThreadStatus = ReadableThreadStatus | Readonly<{ kind: "unreadable"; configName: string }>;

/** Every thread config in force, as the status shows them. */
export interface ThreadStatuses {
    /** Those needing attention first, then the rest, each part in refresh order. */
    readonly threads: readonly ThreadStatus[];
    /** The names of the disabled thread configs, in config page order. */
    readonly disabled: readonly string[];
    readonly hourlyCheckScheduled: boolean;
}

/** The thread config's live post, for opening it. */
export type LivePostLink = Readonly<{ postId: string; permalink: string }>;

/** What the status reads once, for every thread config. */
interface StatusSnapshot {
    readonly now: Date;
    readonly pending: readonly PendingRefresh[];
    readonly livePostIds: Readonly<Record<string, string>>;
    readonly handovers: Readonly<Record<string, Handover>>;
    readonly refreshStatuses: Readonly<Record<string, RefreshStatus>>;
    readonly hourlyCheckScheduled: boolean;
}

const NO_REFRESH_STATUS: RefreshStatus = {
    lastRefresh: undefined,
    lastSuccessAt: undefined,
    nextRefreshAt: undefined,
    nextRefreshReason: undefined,
};

/** Whether the status shows the thread config as needing attention. */
export function needsAttention(status: ThreadStatus): boolean {
    return status.kind === "unreadable" || status.attention.length > 0;
}

/** The record's own value under `key`: a thread config may be named anything, "constructor" included. */
function ownValue<Value>(record: Readonly<Record<string, Value>>, key: string): Value | undefined {
    return Object.hasOwn(record, key) ? record[key] : undefined;
}

async function takeSnapshot(configNames: readonly string[], ports: StatusPorts): Promise<StatusSnapshot> {
    const [pending, livePostIds, handovers, refreshStatuses, hourlyCheckScheduled] = await Promise.all([
        ports.refreshJobs.pending(),
        ports.livePosts.all(),
        ports.livePosts.handovers(),
        ports.refreshStatus.read(configNames),
        ports.refreshJobs.hasHourlyCheck(),
    ]);
    return { now: new Date(), pending, livePostIds, handovers, refreshStatuses, hourlyCheckScheduled };
}

/** The thread config's live post as Reddit shows it; one Reddit cannot give is shown as such, and logged. */
async function readLivePost(
    configName: string,
    postId: string | undefined,
    ports: StatusPorts,
): Promise<LivePostStatus> {
    if (postId === undefined) {
        return { kind: "none" };
    }

    const commentCap = await ports.livePosts.getCommentCap(postId);
    try {
        const post = await ports.posts.get(postId);
        return {
            kind: "readable",
            id: post.id,
            title: post.title,
            createdAt: post.createdAt,
            comments: post.numberOfComments,
            commentCap,
        };
    } catch (error: unknown) {
        console.error(`The status could not read live post ${postId} of thread config ${configName}:`, error);
        return { kind: "unreadable", postId };
    }
}

async function readThread(config: ThreadConfig, snapshot: StatusSnapshot, ports: StatusPorts): Promise<ThreadStatus> {
    const postId = ownValue(snapshot.livePostIds, config.name);
    const livePost = await readLivePost(config.name, postId, ports);
    const refreshStatus = ownValue(snapshot.refreshStatuses, config.name) ?? NO_REFRESH_STATUS;
    const handover = ownValue(snapshot.handovers, config.name);
    const hasSchedule = getSchedule(config) !== undefined;
    const attention = findAttentionReasons(
        {
            applied: await ports.appliedThreadConfigs.matches(config),
            hasLivePost: postId !== undefined,
            hasUnfinishedHandover: handover !== undefined,
            hasSchedule,
            pendingRunTimes: snapshot.pending
                .filter((refresh: PendingRefresh): boolean => refresh.configName === config.name)
                .map((refresh: PendingRefresh): Date => refresh.runAt),
            lastRefreshFailed: refreshStatus.lastRefresh?.outcome === "failed",
            postReadable: livePost.kind !== "unreadable",
        },
        snapshot.now,
    );
    return { kind: "readable", configName: config.name, hasSchedule, livePost, refreshStatus, handover, attention };
}

/** Reads one thread config's status; a failure is logged and shown, so it cannot hide the others. */
async function readThreadIsolated(
    config: ThreadConfig,
    snapshot: StatusSnapshot,
    ports: StatusPorts,
): Promise<ThreadStatus> {
    try {
        return await readThread(config, snapshot, ports);
    } catch (error: unknown) {
        console.error(`The status could not read thread config ${config.name}:`, error);
        return { kind: "unreadable", configName: config.name };
    }
}

/**
 * Each thread config in force as the status shows it, those needing attention first, with the disabled ones' names and
 * whether the hourly refresh check is scheduled. It takes the thread configs the status read, so both halves of the
 * status describe the same ones. It only reads.
 */
export async function getThreadStatuses(configs: readonly ThreadConfig[], ports: StatusPorts): Promise<ThreadStatuses> {
    const inForce = inRefreshOrder(configs);
    const snapshot = await takeSnapshot(
        inForce.map((config: ThreadConfig): string => config.name),
        ports,
    );
    const threads = await Promise.all(
        inForce.map(
            async (config: ThreadConfig): Promise<ThreadStatus> => await readThreadIsolated(config, snapshot, ports),
        ),
    );
    return {
        threads: putFirst(threads, needsAttention),
        disabled: configs
            .filter((config: ThreadConfig): boolean => !config.enabled)
            .map((config: ThreadConfig): string => config.name),
        hourlyCheckScheduled: snapshot.hourlyCheckScheduled,
    };
}

/** The thread config's live post, for opening it: its ID and permalink; undefined when it has none. */
export async function findLivePostLink(
    configName: string,
    ports: Pick<RotationPorts, "livePosts" | "posts">,
): Promise<LivePostLink | undefined> {
    const postId = await ports.livePosts.get(configName);
    if (postId === undefined) {
        return undefined;
    }

    const post = await ports.posts.get(postId);
    return { postId: post.id, permalink: post.permalink };
}
