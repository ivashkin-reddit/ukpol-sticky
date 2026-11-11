import type { T3 } from "@devvit/web/shared";
import { describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { redditHighlights } from "./redditHighlights.js";
import type { HighlightablePost, HighlightedSubreddit, RedditHighlightsContext } from "./redditHighlights.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

interface FakeReddit {
    readonly context: RedditHighlightsContext;
    readonly getHighlightedPosts: Mock<HighlightedSubreddit["getHighlightedPosts"]>;
    readonly reorderHighlightedPosts: Mock<HighlightedSubreddit["reorderHighlightedPosts"]>;
    readonly getPostById: Mock<RedditHighlightsContext["reddit"]["getPostById"]>;
    readonly highlight: Mock<HighlightablePost["highlight"]>;
    readonly unhighlight: Mock<HighlightablePost["unhighlight"]>;
}

/** Devvit's Reddit API as the adapter uses it: every post is `t3_post` in `subredditName`. */
function createFakeReddit(subredditName = "testsub"): FakeReddit {
    const getHighlightedPosts = vi.fn<HighlightedSubreddit["getHighlightedPosts"]>().mockResolvedValue([]);
    const reorderHighlightedPosts = vi
        .fn<HighlightedSubreddit["reorderHighlightedPosts"]>()
        .mockResolvedValue(undefined);
    const highlight = vi.fn<HighlightablePost["highlight"]>().mockResolvedValue(undefined);
    const unhighlight = vi.fn<HighlightablePost["unhighlight"]>().mockResolvedValue(undefined);
    const getPostById = vi
        .fn<RedditHighlightsContext["reddit"]["getPostById"]>()
        .mockResolvedValue({ id: "t3_post", title: "A post", subredditName, highlight, unhighlight });
    const context: RedditHighlightsContext = {
        subredditName: "TestSub",
        reddit: {
            getCurrentSubreddit: vi
                .fn<RedditHighlightsContext["reddit"]["getCurrentSubreddit"]>()
                .mockResolvedValue({ getHighlightedPosts, reorderHighlightedPosts }),
            getPostById,
        },
    };
    return { context, getHighlightedPosts, reorderHighlightedPosts, getPostById, highlight, unhighlight };
}

describe("redditHighlights().list", (): void => {
    it("lists the highlights in display order with Sticky Manager's labels", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit();
        fake.getHighlightedPosts.mockResolvedValue([
            { postId: "t3_a", highlightLabel: "MEGATHREAD" },
            { postId: "t3_b" },
            { postId: "t3_c", highlightLabel: "ANNOUNCEMENT" },
            { postId: "t3_d", highlightLabel: "EVENT" },
            { postId: "t3_e", highlightLabel: "SHOW_POST_FLAIR" },
        ]);

        await expect(redditHighlights(fake.context).list()).resolves.toStrictEqual([
            { postId: "t3_a", label: "megathread" },
            { postId: "t3_b", label: undefined },
            { postId: "t3_c", label: "announcement" },
            { postId: "t3_d", label: "event" },
            { postId: "t3_e", label: undefined },
        ]);
    });
});

describe("redditHighlights().pin", (): void => {
    it("highlights the post with Devvit's name for the label", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeReddit();

        await redditHighlights(fake.context).pin("t3_post", "megathread");

        expect(fake.getPostById).toHaveBeenCalledExactlyOnceWith("t3_post");
        expect(fake.highlight).toHaveBeenCalledExactlyOnceWith({ highlightLabelType: "MEGATHREAD" });
    });

    it("highlights the post with no label for none", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit();

        await redditHighlights(fake.context).pin("t3_post", undefined);

        expect(fake.highlight).toHaveBeenCalledExactlyOnceWith({});
    });

    it("rejects an ID that is not a post's before calling Reddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeReddit();

        await expect(redditHighlights(fake.context).pin("t1_comment", undefined)).rejects.toThrow("t1_comment");
        expect(fake.getPostById).not.toHaveBeenCalled();
    });
});

describe("redditHighlights().unpin", (): void => {
    it("unhighlights the post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit();

        await redditHighlights(fake.context).unpin("t3_post");

        expect(fake.unhighlight).toHaveBeenCalledExactlyOnceWith();
    });
});

describe("redditHighlights().reorder", (): void => {
    it("passes the order to Reddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit();

        await redditHighlights(fake.context).reorder(["t3_b", "t3_a"]);

        expect(fake.reorderHighlightedPosts).toHaveBeenCalledExactlyOnceWith(["t3_b", "t3_a"] satisfies T3[]);
    });
});

describe("redditHighlights().readPost", (): void => {
    it("reads a post of this subreddit, matching its name in any case", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit("testsub");

        await expect(redditHighlights(fake.context).readPost("t3_post")).resolves.toStrictEqual({
            id: "t3_post",
            title: "A post",
        });
    });

    it("reads a post of another subreddit as undefined", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeReddit("othersub");

        await expect(redditHighlights(fake.context).readPost("t3_post")).resolves.toBeUndefined();
    });
});
