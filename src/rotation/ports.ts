import type { ThreadConfig } from "../configuration/index.js";
import type { AlertLatch, NotifyModerators } from "../notifications/index.js";

// What the rotation use cases need from outside the module. Adapters (adapters/) implement these, and the
// composition root (src/composition.ts) wires them.

export interface ManagedComment {
    readonly id: string;
    readonly distinguish: (makeSticky?: boolean) => Promise<void>;
}

/** The parts of a Reddit post that rotation reads and calls. */
export interface ManagedPost {
    readonly id: string;
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

/** Pending refreshes, and the hourly refresh check. */
export interface RefreshJobs {
    /** When each pending refresh is due, earliest first; empty when none is pending. */
    readonly pendingRunTimes: () => Promise<readonly Date[]>;
    /**
     * Schedules a refresh at `runAt`, then cancels every other pending refresh: the new one is in place before any is
     * cancelled, so a failure in between leaves a refresh pending, never none.
     */
    readonly replaceWith: (runAt: Date) => Promise<void>;
    readonly cancelAll: () => Promise<void>;
    /** Whether the hourly refresh check is scheduled. */
    readonly hasHourlyCheck: () => Promise<boolean>;
    /** Starts the hourly refresh check, replacing any earlier one. */
    readonly startHourlyCheck: () => Promise<void>;
}

/** How the last refresh ended. */
export type LastRefresh =
    Readonly<{ at: Date; outcome: "failed"; failure: string }> | Readonly<{ at: Date; outcome: "succeeded" }>;

/** Whether refreshes are running: what the last one did, when one last succeeded, and when the next is due. */
export interface RefreshStatus {
    /** Undefined until the first refresh. */
    readonly lastRefresh: LastRefresh | undefined;
    readonly lastSuccessAt: Date | undefined;
    /** Undefined when no refresh is scheduled; in the past when a scheduled refresh did not run or did not finish. */
    readonly nextRefreshAt: Date | undefined;
}

/** The refresh status, recorded as refreshes run and are scheduled. */
export interface RefreshStatusStore {
    readonly read: () => Promise<RefreshStatus>;
    readonly recordSuccess: (at: Date) => Promise<void>;
    readonly recordFailure: (at: Date, failure: string) => Promise<void>;
    /** Records when the next refresh is due, or that none is scheduled. */
    readonly recordNextRefresh: (at: Date | undefined) => Promise<void>;
}

/** The thread configs in force. */
export type LoadThreadConfigs = () => Promise<readonly ThreadConfig[]>;

/** Every port the rotation use cases take; each use case declares the subset it uses. */
export interface RotationPorts {
    readonly livePosts: LivePosts;
    readonly notifyModerators: NotifyModerators;
    readonly posts: Posts;
    /** Keeps the alert about failed refreshes to one until a refresh succeeds again. */
    readonly refreshFailureAlert: AlertLatch;
    readonly refreshJobs: RefreshJobs;
    readonly refreshStatus: RefreshStatusStore;
    readonly threadConfigs: LoadThreadConfigs;
    readonly threadLocks: ThreadLocks;
}
