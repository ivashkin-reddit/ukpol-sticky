import type { ThreadConfig } from "../configuration/index.js";
import type { AlertLatch, NotifyModerators } from "../notifications/index.js";

// What the rotation use cases need from outside the module. Adapters (adapters/) implement these, and the
// composition root (src/composition.ts) wires them.

export interface ManagedComment {
    readonly distinguish: (makeSticky?: boolean) => Promise<void>;
}

/** The parts of a Reddit post that rotation reads and calls. */
export interface ManagedPost {
    readonly id: string;
    readonly createdAt: Date;
    readonly numberOfComments: number;
    readonly body?: string | undefined;
    readonly stickied: boolean;
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
    /** Submits a new post to the subreddit. */
    readonly publish: (post: Readonly<{ title: string; body: string }>) => Promise<ManagedPost>;
}

/** Which post is live for each thread config, and each live post's comment cap. */
export interface LivePosts {
    /** Thread config name -> ID of its live post. */
    readonly all: () => Promise<Readonly<Record<string, string>>>;
    readonly get: (configName: string) => Promise<string | undefined>;
    /** The names of the thread configs that have a live post. */
    readonly configNames: () => Promise<readonly string[]>;
    readonly set: (configName: string, postId: string) => Promise<void>;
    /** Stops recording the named thread configs' live posts, and forgets the comment caps of the given posts. */
    readonly forget: (configNames: readonly string[], postIds: readonly string[]) => Promise<void>;
    /** The post's comment cap, or undefined when none is stored for it. */
    readonly getCommentCap: (postId: string) => Promise<number | undefined>;
    readonly storeCommentCap: (postId: string, commentCap: number) => Promise<void>;
}

/** Pending refreshes, and the hourly refresh check. */
export interface RefreshJobs {
    readonly cancelAll: () => Promise<void>;
    readonly scheduleAt: (runAt: Date) => Promise<void>;
    /** Whether a refresh is pending. */
    readonly isPending: () => Promise<boolean>;
    /** Starts the hourly refresh check, replacing any earlier one. */
    readonly startHourlyCheck: () => Promise<void>;
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
    readonly threadConfigs: LoadThreadConfigs;
}
