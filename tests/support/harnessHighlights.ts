import { reddit, redis } from "@devvit/web/server";
import { T3 as asPostId } from "@devvit/web/shared";
import type { T3 } from "@devvit/web/shared";
import type { HighlightablePost, HighlightedSubreddit } from "../../src/highlights/adapters/redditHighlights.js";
import type { ManagedPost } from "../../src/rotation/index.js";

// Stand-ins for the highlight calls, which Devvit's test harness does not implement (each throws "not implemented").
// The list is kept as JSON in the harness's Redis, which is fresh for each test, and behaves as Reddit's did when
// probed on r/ukpol_megabot_dev on 2026-11-11: pinning a post not pinned puts it first and drops the last past six;
// pinning a pinned post sets its label in place; unpinning closes the gap; reordering takes the order given.

const HIGHLIGHTS_KEY = "HarnessHighlights";
const HIGHLIGHTS_HELD = 6;

type HighlightOptions = Parameters<HighlightablePost["highlight"]>[0];
export type HarnessLabel = NonNullable<NonNullable<HighlightOptions>["highlightLabelType"]>;
const LABELS: readonly HarnessLabel[] = ["ANNOUNCEMENT", "EVENT", "MEGATHREAD", "SHOW_POST_FLAIR"];

/** One highlight as the harness keeps it, in Devvit's shape. */
export type HarnessHighlight = Readonly<{ postId: T3; highlightLabel?: HarnessLabel }>;

function toHighlight(value: unknown): HarnessHighlight {
    if (typeof value !== "object" || value === null || !("postId" in value) || typeof value.postId !== "string") {
        throw new TypeError(`Not a harness highlight: ${JSON.stringify(value)}`);
    }

    const label =
        "highlightLabel" in value
            ? LABELS.find((known: HarnessLabel): boolean => known === value.highlightLabel)
            : undefined;
    const postId = asPostId(value.postId);
    return label === undefined ? { postId } : { postId, highlightLabel: label };
}

/** The highlights the harness holds now, in display order. */
export async function readHarnessHighlights(): Promise<readonly HarnessHighlight[]> {
    const stored = await redis.get(HIGHLIGHTS_KEY);
    if (stored === undefined) {
        return [];
    }

    const values: unknown = JSON.parse(stored);
    return Array.isArray(values) ? values.map(toHighlight) : [];
}

/** Sets the highlights the harness holds, in display order. */
export async function writeHarnessHighlights(highlights: readonly HarnessHighlight[]): Promise<void> {
    await redis.set(HIGHLIGHTS_KEY, JSON.stringify(highlights));
}

async function pin(postId: T3, options: HighlightOptions): Promise<void> {
    const label = options?.highlightLabelType;
    const pinned: HarnessHighlight = label === undefined ? { postId } : { postId, highlightLabel: label };
    const highlights = await readHarnessHighlights();
    await writeHarnessHighlights(
        highlights.some((entry: HarnessHighlight): boolean => entry.postId === postId)
            ? highlights.map((entry: HarnessHighlight): HarnessHighlight => (entry.postId === postId ? pinned : entry))
            : [pinned, ...highlights].slice(0, HIGHLIGHTS_HELD),
    );
}

async function unpin(postId: T3): Promise<void> {
    const highlights = await readHarnessHighlights();
    await writeHarnessHighlights(highlights.filter((entry: HarnessHighlight): boolean => entry.postId !== postId));
}

/** The current subreddit's highlights, over the harness's list. */
export async function harnessSubreddit(): Promise<HighlightedSubreddit> {
    return await Promise.resolve({
        getHighlightedPosts: async (): Promise<readonly HarnessHighlight[]> => await readHarnessHighlights(),
        reorderHighlightedPosts: async (postIds: readonly T3[]): Promise<void> => {
            const highlights = await readHarnessHighlights();
            await writeHarnessHighlights(
                postIds.flatMap((postId: T3): HarnessHighlight[] =>
                    highlights.filter((entry: HarnessHighlight): boolean => entry.postId === postId),
                ),
            );
        },
    });
}

/** The harness's post, with its highlight calls kept in the harness's list; its getters stay the post's own. */
export async function harnessPost(id: T3): Promise<HighlightablePost & ManagedPost> {
    const post = await reddit.getPostById(id);
    return Object.assign(post, {
        highlight: async (options?: HighlightOptions): Promise<void> => {
            await pin(id, options);
        },
        unhighlight: async (): Promise<void> => {
            await unpin(id);
        },
    });
}
