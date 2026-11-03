import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../tests/support/fakeClock.js";
import { createFakePost, createFakeStickyContext } from "../tests/support/fakeStickyContext.js";
import type { FakePost, FakeStickyContext } from "../tests/support/fakeStickyContext.js";
import type { Config } from "./config.js";
import { createPost } from "./stickyManager.js";

const TEST_OPTIONS = { timeout: 1000 };

const ROTATING_CONFIG: Config = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread {{date yyyy-MM-dd}}",
    maxComments: 200,
    body: "Replacement body",
    sticky: true,
    endNote: "Thread closed",
    lockOnRefresh: true,
};

interface Rotation {
    readonly fakes: FakeStickyContext;
    readonly oldPost: FakePost;
    readonly replacement: FakePost;
}

async function rotate (config: Config, subredditName?: string): Promise<Rotation> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeStickyContext(subredditName);
    const oldPost = createFakePost({ body: "Old body", createdAt: new Date("2026-04-20T10:00:00Z"), id: "t3_old", numberOfComments: 5, stickied: true });
    const replacement = createFakePost({ body: undefined, createdAt: new Date("2026-04-21T10:00:00Z"), id: "t3_replacement", numberOfComments: 0, stickied: false });
    fakes.reddit.submitPost.mockResolvedValue(replacement.post);

    await createPost(oldPost.post, config, fakes.context);
    return { fakes, oldPost, replacement };
}

describe(createPost, (): void => {
    it("retires the old post: unstickies it, adds the end note as a distinguished sticky comment and locks it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const { oldPost } = await rotate(ROTATING_CONFIG, "ukpolitics");

        expect(oldPost.unsticky).toHaveBeenCalledExactlyOnceWith();
        expect(oldPost.addComment).toHaveBeenCalledExactlyOnceWith({ text: "Thread closed" });
        expect(oldPost.commentDistinguish).toHaveBeenCalledExactlyOnceWith(true);
        expect(oldPost.lock).toHaveBeenCalledExactlyOnceWith();
    });

    it("submits the replacement to the configured subreddit with the dated title, then distinguishes and stickies it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const { fakes, replacement } = await rotate(ROTATING_CONFIG, "ukpolitics");

        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({ title: "Daily thread 2026-04-21", text: "Replacement body", subredditName: "ukpolitics" });
        expect(fakes.reddit.getCurrentSubredditName).not.toHaveBeenCalled();
        expect(replacement.distinguish).toHaveBeenCalledExactlyOnceWith();
        expect(replacement.sticky).toHaveBeenCalledExactlyOnceWith();
    });

    it("tracks the replacement and stores its comment cap for 28 days", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { fakes } = await rotate(ROTATING_CONFIG, "ukpolitics");

        expect(fakes.redis.hSet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", { "daily-thread": "t3_replacement" });
        expect(fakes.redis.set).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_replacement", "200", { expiration: new Date("2026-05-19T10:00:00.000Z") });
    });

    it("leaves the old post open and the replacement unstickied when those keys were left empty", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const { oldPost, replacement } = await rotate({ ...ROTATING_CONFIG, endNote: null, lockOnRefresh: null, sticky: null }, "ukpolitics");

        expect(oldPost.addComment).not.toHaveBeenCalled();
        expect(oldPost.lock).not.toHaveBeenCalled();
        expect(replacement.sticky).not.toHaveBeenCalled();
    });

    it("adds no comment for an empty end note", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { oldPost } = await rotate({ ...ROTATING_CONFIG, endNote: "" }, "ukpolitics");

        expect(oldPost.addComment).not.toHaveBeenCalled();
    });

    it("submits to the current subreddit when the context names none", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { fakes } = await rotate(ROTATING_CONFIG);

        expect(fakes.reddit.getCurrentSubredditName).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({ title: "Daily thread 2026-04-21", text: "Replacement body", subredditName: "currentsub" });
    });
});
