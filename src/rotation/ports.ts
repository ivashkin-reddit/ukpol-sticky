import type { ThreadConfig } from "../configuration/index.js";
import type { AlertLatch, NotifyModerators } from "../notifications/index.js";
import type { NextRefreshReason } from "./domain/refreshRules.js";

// What the rotation use cases need from outside the module. Adapters (adapters/) implement these, and the
// composition root (src/composition.ts) wires them.

export interface ManagedComment {
    readonly id: string;
    readonly distinguish: (makeSticky?: boolean) => Promise<void>;
}

/** The parts of a Reddit post that rotation reads and calls. */
export interface ManagedPost {
    readonly id: string;
    readonly title: string;
    /** Its path on Reddit, such as /r/ukpolitics/comments/abc123/daily_thread/. */
    readonly permalink: string;
    readonly createdAt: Date;
    readonly numberOfComments: number;
    readonly body?: string | undefined;
    readonly stickied: boolean;
    readonly locked: boolean;
    /** Who distinguished the post ("moderator", say); undefined while it is not distinguished. */
    readonly distinguishedBy: string | undefined;
    readonly addComment: (options: Readonly<{ text: string }>) => Promise<ManagedComment>;
    readonly distinguish: () => Promise<void>;
    readonly edit: (options: Readonly<{ text: string }>) => Promise<void>;
    readonly lock: () => Promise<void>;
    readonly sticky: () => Promise<void>;
    readonly unsticky: () => Promise<void>;
}

/** The subreddit's posts, as rotation reads and publishes them. */
export interface Posts {
    readonly get: (postId: string) => Promise<ManagedPost>;
    readonly getComment: (commentId: string) => Promise<ManagedComment>;
    /** Submits a new post to the subreddit. */
    readonly publish: (post: Readonly<{ title: string; body: string }>) => Promise<ManagedPost>;
}

/**
 * The rest of a rotation once its new live post is published: distinguishing and stickying the new post, then
 * retiring the old one. Recorded before any of it starts and deleted once all of it is done, so the next refresh after
 * a failure finishes it.
 */
export interface Handover {
    readonly newPostId: string;
    /** The live post being retired; undefined when the thread config had none. */
    readonly oldPostId?: string | undefined;
    /** The end note added to the old post, once added: finishing again distinguishes it rather than adding another. */
    readonly endNoteId?: string | undefined;
}

/** Which post is live for each thread config, each live post's comment cap, and handovers not yet finished. */
export interface LivePosts {
    /** Thread config name -> ID of its live post. */
    readonly all: () => Promise<Readonly<Record<string, string>>>;
    readonly get: (configName: string) => Promise<string | undefined>;
    /** The names of the thread configs that have a live post or an unfinished handover. */
    readonly configNames: () => Promise<readonly string[]>;
    readonly set: (configName: string, postId: string) => Promise<void>;
    /**
     * Stops recording the named thread configs' live posts and unfinished handovers, and forgets the comment caps of
     * the given posts.
     */
    readonly forget: (configNames: readonly string[], postIds: readonly string[]) => Promise<void>;
    /** Thread config name -> its unfinished handover. */
    readonly handovers: () => Promise<Readonly<Record<string, Handover>>>;
    readonly saveHandover: (configName: string, handover: Handover) => Promise<void>;
    readonly forgetHandover: (configName: string) => Promise<void>;
    /** The post's comment cap, or undefined when none is stored for it. */
    readonly getCommentCap: (postId: string) => Promise<number | undefined>;
    readonly storeCommentCap: (postId: string, commentCap: number) => Promise<void>;
    /** Forgets a post's comment cap, as when it is retired. */
    readonly forgetCommentCap: (postId: string) => Promise<void>;
}

/**
 * One refresh at a time per thread config. Triggers and jobs run concurrently: without the lock, two comments that
 * reach a comment cap together would each rotate the thread and publish a replacement.
 */
export interface ThreadLocks {
    /** True for the caller that now holds the thread config's lock; false while another caller holds it. */
    readonly tryLock: (configName: string) => Promise<boolean>;
    readonly unlock: (configName: string) => Promise<void>;
}

/** A pending refresh: which thread config it refreshes, and when it is due. */
export interface PendingRefresh {
    /** Undefined for one scheduled before refreshes were per thread config, which refreshes every thread config. */
    readonly configName: string | undefined;
    readonly runAt: Date;
}

/** Pending refreshes, each of one thread config, and the hourly refresh check. */
export interface RefreshJobs {
    /** Every pending refresh, earliest first. */
    readonly pending: () => Promise<readonly PendingRefresh[]>;
    /**
     * Schedules a refresh of the thread config at `runAt`, then cancels its other pending refreshes: the new one is in
     * place before any is cancelled, so a failure in between leaves one pending, never none.
     */
    readonly replaceFor: (configName: string, runAt: Date) => Promise<void>;
    readonly cancelFor: (configName: string) => Promise<void>;
    /** Cancels pending refreshes scheduled before refreshes were per thread config. */
    readonly cancelUnassigned: () => Promise<void>;
    /** Whether the hourly refresh check is scheduled. */
    readonly hasHourlyCheck: () => Promise<boolean>;
    /** Starts the hourly refresh check, replacing any earlier one. */
    readonly startHourlyCheck: () => Promise<void>;
}

/** How a thread config's last refresh ended. */
export type LastRefresh =
    Readonly<{ at: Date; outcome: "failed"; failure: string }> | Readonly<{ at: Date; outcome: "succeeded" }>;

/** A thread config's next refresh as recorded: when it is due, and why. */
export interface ScheduledRefresh {
    readonly at: Date;
    readonly reason: NextRefreshReason;
}

/**
 * Whether a thread config's refreshes are running: how its last ended, when one last succeeded, and when and why its
 * next is due.
 */
export interface RefreshStatus {
    /** Undefined until its first refresh. */
    readonly lastRefresh: LastRefresh | undefined;
    readonly lastSuccessAt: Date | undefined;
    /** Undefined when no refresh of it is scheduled; in the past when one did not run or did not finish. */
    readonly nextRefreshAt: Date | undefined;
    /** Why its next refresh is due; undefined when none is scheduled, or for a record from before reasons were kept. */
    readonly nextRefreshReason: NextRefreshReason | undefined;
}

/** Each thread config's refresh status, recorded as its refreshes run and are scheduled. */
export interface RefreshStatusStore {
    /** The named thread configs' refresh status, by name. */
    readonly read: (configNames: readonly string[]) => Promise<Readonly<Record<string, RefreshStatus>>>;
    readonly recordSuccess: (configName: string, at: Date) => Promise<void>;
    readonly recordFailure: (configName: string, at: Date, failure: string) => Promise<void>;
    /** Records when the thread config's next refresh is due and why, or that none is scheduled. */
    readonly recordNextRefresh: (configName: string, next: ScheduledRefresh | undefined) => Promise<void>;
    readonly forget: (configNames: readonly string[]) => Promise<void>;
}

/** The thread configs in force. */
export type LoadThreadConfigs = () => Promise<readonly ThreadConfig[]>;

/**
 * The version of each thread config that its last refresh applied. While a thread config's stored version differs,
 * it needs a refresh at once, so the need to apply a save outlives any pending refresh that rescheduling replaces.
 */
export interface AppliedThreadConfigs {
    /** Whether `config` is the version its last refresh applied; false until a refresh of it has recorded one. */
    readonly matches: (config: ThreadConfig) => Promise<boolean>;
    readonly record: (config: ThreadConfig) => Promise<void>;
    /** The names of the thread configs with an applied version recorded. */
    readonly configNames: () => Promise<readonly string[]>;
    readonly forget: (configNames: readonly string[]) => Promise<void>;
}

/**
 * What refreshes recorded for all thread configs at once, before they were per thread config. The upgrade migrates it,
 * then deletes it; nothing writes it any more.
 */
export interface RetiredRefreshRecords {
    /** The thread configs the last refresh of all applied, as JSON; undefined when none is recorded. */
    readonly readAppliedThreadConfigs: () => Promise<string | undefined>;
    /** Deletes the record of applied thread configs and the refresh status kept for all thread configs. */
    readonly delete: () => Promise<void>;
}

/** Every port the rotation use cases take; each use case declares the subset it uses. */
export interface RotationPorts {
    readonly appliedThreadConfigs: AppliedThreadConfigs;
    readonly livePosts: LivePosts;
    readonly notifyModerators: NotifyModerators;
    readonly posts: Posts;
    /** Keeps the alert about failures that belong to no single thread config to one until a refresh check succeeds. */
    readonly refreshFailureAlert: AlertLatch;
    readonly refreshJobs: RefreshJobs;
    readonly refreshStatus: RefreshStatusStore;
    readonly retiredRefreshRecords: RetiredRefreshRecords;
    readonly threadConfigs: LoadThreadConfigs;
    /** Keeps the alert about a thread config's failed refreshes to one until it refreshes successfully again. */
    readonly threadFailureAlert: (configName: string) => AlertLatch;
    readonly threadLocks: ThreadLocks;
}
