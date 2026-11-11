import { T3 as asPostId } from "@devvit/web/shared";
import type { T3 } from "@devvit/web/shared";
import type { PostRef } from "../../changes/index.js";
import type { SubredditNamePort } from "../../platform/index.js";
import type { HighlightLabel } from "../domain/labels.js";
import type { Highlight, Highlights } from "../ports.js";

// Devvit's label names (HighlightLabelType, which @devvit/web/server re-exports as a type with no runtime value).
type DevvitLabel = "ANNOUNCEMENT" | "EVENT" | "MEGATHREAD" | "SHOW_POST_FLAIR";

const TO_DEVVIT: Readonly<Record<HighlightLabel, DevvitLabel>> = {
    announcement: "ANNOUNCEMENT",
    event: "EVENT",
    megathread: "MEGATHREAD",
};

/** The parts of a Reddit post the highlights read and call. */
export type HighlightablePost = Readonly<{
    id: string;
    title: string;
    subredditName: string;
    highlight: (options?: Readonly<{ highlightLabelType?: DevvitLabel }>) => Promise<void>;
    unhighlight: () => Promise<void>;
}>;

/** The subreddit's highlights as Devvit lists them, and their reordering. */
export type HighlightedSubreddit = Readonly<{
    getHighlightedPosts: () => Promise<readonly Readonly<{ postId: T3; highlightLabel?: DevvitLabel }>[]>;
    reorderHighlightedPosts: (postIds: readonly T3[]) => Promise<void>;
}>;

export type RedditHighlightsContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getCurrentSubreddit: () => Promise<HighlightedSubreddit>;
            getPostById: (id: T3) => Promise<HighlightablePost>;
        }>;
    }>;

/** A label Sticky Manager sets; SHOW_POST_FLAIR, which it never sets, reads as none. */
function fromDevvit(label: DevvitLabel | undefined): HighlightLabel | undefined {
    switch (label) {
        case "ANNOUNCEMENT":
            return "announcement";
        case "EVENT":
            return "event";
        case "MEGATHREAD":
            return "megathread";
        case "SHOW_POST_FLAIR":
        case undefined:
            return undefined;
    }
}

async function listHighlights(context: RedditHighlightsContext): Promise<readonly Highlight[]> {
    const subreddit = await context.reddit.getCurrentSubreddit();
    return (await subreddit.getHighlightedPosts()).map(
        (entry: Readonly<{ postId: T3; highlightLabel?: DevvitLabel }>): Highlight => ({
            postId: entry.postId,
            label: fromDevvit(entry.highlightLabel),
        }),
    );
}

async function readPost(context: RedditHighlightsContext, postId: string): Promise<PostRef | undefined> {
    const post = await context.reddit.getPostById(asPostId(postId));
    return post.subredditName.toLowerCase() === context.subredditName.toLowerCase()
        ? { id: post.id, title: post.title }
        : undefined;
}

/** The subreddit's highlights through Devvit's Reddit API. An ID that is not a post's (t3_) is rejected first. */
export function redditHighlights(context: RedditHighlightsContext): Highlights {
    return {
        list: async (): Promise<readonly Highlight[]> => await listHighlights(context),
        pin: async (postId: string, label: HighlightLabel | undefined): Promise<void> => {
            const post = await context.reddit.getPostById(asPostId(postId));
            await post.highlight(label === undefined ? {} : { highlightLabelType: TO_DEVVIT[label] });
        },
        unpin: async (postId: string): Promise<void> => {
            await (await context.reddit.getPostById(asPostId(postId))).unhighlight();
        },
        reorder: async (postIds: readonly string[]): Promise<void> => {
            const subreddit = await context.reddit.getCurrentSubreddit();
            await subreddit.reorderHighlightedPosts(postIds.map((id: string): T3 => asPostId(id)));
        },
        readPost: async (postId: string): Promise<PostRef | undefined> => await readPost(context, postId),
    };
}
