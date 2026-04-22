import { afterEach, vi } from "vitest";
import { createPost, getRefreshTime } from "./stickyManager.js";
import { Config } from "./config.js";

afterEach(() => {
    vi.useRealTimers();
});

test("getRefreshTime returns undefined when schedule is omitted", () => {
    const config = {
        maxComments: 100,
    } as unknown as Config;

    expect(getRefreshTime(new Date("2023-02-02T02:00:00Z"), config)).toBeUndefined();
});

test("getRefreshTime with daily frequency", () => {
    const config = {
        frequency: "daily",
        postTime: "14:00",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:00:00Z");
    const result = getRefreshTime(new Date("2023-02-02T02:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with daily frequency preserves minutes", () => {
    const config = {
        frequency: "daily",
        postTime: "14:30",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:30:00Z");
    const result = getRefreshTime(new Date("2023-02-02T02:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime uses UTC day math during DST months", () => {
    const config = {
        frequency: "daily",
        postTime: "12:30",
    } as unknown as Config;

    const expected = new Date("2026-04-21T12:30:00Z");
    const result = getRefreshTime(new Date("2026-04-21T05:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with daily frequency and recent refresh", () => {
    const config = {
        frequency: "daily",
        postTime: "14:00",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:00:00Z");
    const result = getRefreshTime(new Date("2023-02-01T13:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency", () => {
    const config = {
        frequency: "wednesdays",
        postTime: "01:00",
    } as unknown as Config;

    const expected = new Date("2025-02-12T01:00:00Z");
    const result = getRefreshTime(new Date("2025-02-06T12:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency preserves minutes", () => {
    const config = {
        frequency: "wednesdays",
        postTime: "01:30",
    } as unknown as Config;

    const expected = new Date("2025-02-12T01:30:00Z");
    const result = getRefreshTime(new Date("2025-02-06T12:00:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency and recent refresh", () => {
    const config = {
        frequency: "wednesdays",
        postTime: "01:00",
    } as unknown as Config;

    const expected = new Date("2025-02-19T01:00:00Z");
    const result = getRefreshTime(new Date("2025-02-12T00:30:00Z"), config);
    expect(result?.toISOString()).toBe(expected.toISOString());
});

test("createPost rotates an existing sticky post and stores the replacement state", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    const newComment = {
        distinguish: vi.fn().mockResolvedValue(undefined),
    };
    const existingPost = {
        addComment: vi.fn().mockResolvedValue(newComment),
        lock: vi.fn().mockResolvedValue(undefined),
        stickied: true,
        unsticky: vi.fn().mockResolvedValue(undefined),
    };
    const newPost = {
        distinguish: vi.fn().mockResolvedValue(undefined),
        id: "t3_replacement",
        sticky: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
        reddit: {
            getCurrentSubredditName: vi.fn().mockResolvedValue("fallbacksub"),
            submitPost: vi.fn().mockResolvedValue(newPost),
        },
        redis: {
            hSet: vi.fn().mockResolvedValue(undefined),
            set: vi.fn().mockResolvedValue(undefined),
        },
        subredditName: "ukpolitics",
    };

    await createPost(existingPost as never, {
        body: "Replacement body",
        enabled: true,
        endNote: "Thread closed",
        lockOnRefresh: true,
        maxComments: 200,
        name: "daily-thread",
        sticky: true,
        title: "Daily thread {{date yyyy-MM-dd}}",
    }, context as never);

    expect(existingPost.unsticky).toHaveBeenCalledTimes(1);
    expect(existingPost.addComment).toHaveBeenCalledWith({ text: "Thread closed" });
    expect(newComment.distinguish).toHaveBeenCalledWith(true);
    expect(existingPost.lock).toHaveBeenCalledTimes(1);
    expect(context.reddit.getCurrentSubredditName).not.toHaveBeenCalled();
    expect(context.reddit.submitPost).toHaveBeenCalledWith({
        subredditName: "ukpolitics",
        text: "Replacement body",
        title: "Daily thread 2026-04-21",
    });
    expect(newPost.distinguish).toHaveBeenCalledTimes(1);
    expect(newPost.sticky).toHaveBeenCalledTimes(1);
    expect(context.redis.hSet).toHaveBeenCalledWith("StickyPostStore", { "daily-thread": "t3_replacement" });
    expect(context.redis.set).toHaveBeenCalledWith(
        "CommentCap:t3_replacement",
        JSON.stringify(200),
        { expiration: new Date("2026-05-19T10:00:00.000Z") },
    );
});

test("createPost creates a fresh post with the current subreddit when no subreddit name is provided", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    const newPost = {
        distinguish: vi.fn().mockResolvedValue(undefined),
        id: "t3_fresh",
        sticky: vi.fn().mockResolvedValue(undefined),
    };
    const context = {
        reddit: {
            getCurrentSubredditName: vi.fn().mockResolvedValue("fallbacksub"),
            submitPost: vi.fn().mockResolvedValue(newPost),
        },
        redis: {
            hSet: vi.fn().mockResolvedValue(undefined),
            set: vi.fn().mockResolvedValue(undefined),
        },
        subredditName: undefined,
    };

    await createPost(undefined, {
        body: "Fresh body",
        enabled: true,
        maxComments: 150,
        name: "fresh-thread",
        sticky: false,
        title: "Fresh thread",
    }, context as never);

    expect(context.reddit.getCurrentSubredditName).toHaveBeenCalledTimes(1);
    expect(context.reddit.submitPost).toHaveBeenCalledWith({
        subredditName: "fallbacksub",
        text: "Fresh body",
        title: "Fresh thread",
    });
    expect(newPost.distinguish).toHaveBeenCalledTimes(1);
    expect(newPost.sticky).not.toHaveBeenCalled();
    expect(context.redis.hSet).toHaveBeenCalledWith("StickyPostStore", { "fresh-thread": "t3_fresh" });
    expect(context.redis.set).toHaveBeenCalledWith(
        "CommentCap:t3_fresh",
        JSON.stringify(150),
        { expiration: new Date("2026-05-19T10:00:00.000Z") },
    );
});
