import { vi } from "vitest";
import type { Mock } from "vitest";
import type { PostRef } from "../../src/changes/index.js";
import type { Highlight, HighlightLabel, Highlights } from "../../src/highlights/index.js";

export interface FakeHighlights {
    readonly highlights: Highlights;
    readonly list: Mock<Highlights["list"]>;
    readonly pin: Mock<Highlights["pin"]>;
    readonly unpin: Mock<Highlights["unpin"]>;
    readonly reorder: Mock<Highlights["reorder"]>;
    readonly readPost: Mock<Highlights["readPost"]>;
    /** The highlights now, in display order. */
    readonly current: () => readonly Highlight[];
}

/** Reddit holds six highlights; pinning a seventh drops the last. */
const HIGHLIGHTS_HELD = 6;

/** The highlights' state, changed in place as Reddit's would be. */
interface HighlightsState {
    entries: readonly Highlight[];
}

/** `entries` once `pinned` is pinned: its label set in place if pinned, else first, dropping the last past six. */
function pinning(entries: readonly Highlight[], pinned: Highlight): readonly Highlight[] {
    return entries.some((entry: Highlight): boolean => entry.postId === pinned.postId)
        ? entries.map((entry: Highlight): Highlight => (entry.postId === pinned.postId ? pinned : entry))
        : [pinned, ...entries].slice(0, HIGHLIGHTS_HELD);
}

/** `entries` in the order `postIds` gives. */
function reordering(entries: readonly Highlight[], postIds: readonly string[]): readonly Highlight[] {
    return postIds.flatMap((postId: string): Highlight[] =>
        entries.filter((entry: Highlight): boolean => entry.postId === postId),
    );
}

/**
 * Highlights that behave as Reddit's (probed 2026-11-11): pinning a post not pinned puts it first and drops the last
 * past six; pinning a pinned post sets its label in place; unpinning closes the gap; reordering takes the order given.
 * Every post reads as a post of this subreddit titled "Title of <id>", unless `foreign` names it.
 */
export function createFakeHighlights(
    initial: readonly Highlight[] = [],
    foreign: readonly string[] = [],
): FakeHighlights {
    const state: HighlightsState = { entries: [...initial] };
    const list = vi
        .fn<Highlights["list"]>()
        .mockImplementation(async (): Promise<readonly Highlight[]> => await Promise.resolve([...state.entries]));
    const pin = vi
        .fn<Highlights["pin"]>()
        .mockImplementation(async (postId: string, label: HighlightLabel | undefined): Promise<void> => {
            state.entries = pinning(state.entries, { postId, label });
            await Promise.resolve();
        });
    const unpin = vi.fn<Highlights["unpin"]>().mockImplementation(async (postId: string): Promise<void> => {
        state.entries = state.entries.filter((entry: Highlight): boolean => entry.postId !== postId);
        await Promise.resolve();
    });
    const reorder = vi
        .fn<Highlights["reorder"]>()
        .mockImplementation(async (postIds: readonly string[]): Promise<void> => {
            state.entries = reordering(state.entries, postIds);
            await Promise.resolve();
        });
    const readPost = vi
        .fn<Highlights["readPost"]>()
        .mockImplementation(
            async (postId: string): Promise<PostRef | undefined> =>
                await Promise.resolve(
                    foreign.includes(postId) ? undefined : { id: postId, title: `Title of ${postId}` },
                ),
        );
    return {
        highlights: { list, pin, unpin, reorder, readPost },
        list,
        pin,
        unpin,
        reorder,
        readPost,
        current: (): readonly Highlight[] => state.entries,
    };
}

/** Highlights of `postIds` in that order, with no labels. */
export function unlabelled(...postIds: readonly string[]): Highlight[] {
    return postIds.map((postId: string): Highlight => ({ postId, label: undefined }));
}
