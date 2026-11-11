import type { ChangeHistoryStore, PostRef } from "../changes/index.js";
import type { HighlightLabel } from "./domain/labels.js";

// What the highlights use cases need from outside the module. Adapters (adapters/) implement these; rotation supplies
// ManagedPostLock; the composition root (src/composition.ts) wires them.

/** One pinned post, as the highlights list it. */
export interface Highlight {
    readonly postId: string;
    readonly label: HighlightLabel | undefined;
}

/** The subreddit's highlights. */
export interface Highlights {
    /** The pinned posts, in display order. */
    readonly list: () => Promise<readonly Highlight[]>;
    /** Pins the post with `label`, or sets the label of a pinned post. Reddit puts a newly pinned post first. */
    readonly pin: (postId: string, label: HighlightLabel | undefined) => Promise<void>;
    readonly unpin: (postId: string) => Promise<void>;
    /** Puts the highlights in this order, which names every pinned post once. */
    readonly reorder: (postIds: readonly string[]) => Promise<void>;
    /** The post's ID and title; undefined when it is not a post of this subreddit. */
    readonly readPost: (postId: string) => Promise<PostRef | undefined>;
}

/**
 * Runs `run` holding the lock of the managed thread whose live post `postId` is, as a refresh would, so it never
 * interleaves with that thread's rotation; runs it without a lock for any other post. Busy while a refresh holds it.
 */
export type ManagedPostLock = <Result>(
    postId: string,
    run: () => Promise<Result>,
) => Promise<Readonly<{ kind: "busy" }> | Readonly<{ kind: "ran"; result: Result }>>;

/** Every port the highlights use cases take. */
export interface HighlightsPorts {
    readonly highlights: Highlights;
    readonly managedPostLock: ManagedPostLock;
    readonly changeHistory: ChangeHistoryStore;
}
