import { describe, expect, it } from "vitest";
import { freezeTime } from "../../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisLivePosts } from "./redisLivePosts.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisLivePosts, (): void => {
    it("reads live posts from the StickyPostStore hash", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const { redis } = createFakeDevvitContext();
        const livePosts = redisLivePosts(redis);
        await livePosts.all();
        await livePosts.get("alpha");
        await livePosts.configNames();

        expect(redis.hGetAll).toHaveBeenCalledExactlyOnceWith("StickyPostStore");
        expect(redis.hGet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", "alpha");
        expect(redis.hKeys).toHaveBeenCalledExactlyOnceWith("StickyPostStore");
    });

    it("records a live post in the StickyPostStore hash", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).set("alpha", "t3_alpha");

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", { alpha: "t3_alpha" });
    });

    it("forgets live posts and the comment caps of the given posts", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).forget(["alpha", "beta"], ["t3_alpha", "t3_beta"]);

        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("StickyPostStore", ["alpha", "beta"]);
        expect(redis.del).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha", "CommentCap:t3_beta");
    });

    it("deletes no comment cap when no post is given", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).forget(["alpha"], []);

        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("StickyPostStore", ["alpha"]);
        expect(redis.del).not.toHaveBeenCalled();
    });

    it("stores a comment cap that expires after 28 days", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).storeCommentCap("t3_alpha", 200);

        expect(redis.set).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha", "200", {
            expiration: new Date("2026-05-19T10:00:00.000Z"),
        });
    });
});

describe("redisLivePosts().getCommentCap", (): void => {
    it("returns undefined when no cap is stored for the post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();

        await expect(redisLivePosts(redis).getCommentCap("t3_alpha")).resolves.toBeUndefined();
        expect(redis.get).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha");
    });

    it("returns the stored cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        redis.get.mockResolvedValue("150");

        await expect(redisLivePosts(redis).getCommentCap("t3_alpha")).resolves.toBe(150);
    });

    it("throws when the stored cap is not a number", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        redis.get.mockResolvedValue('"150"');

        await expect(redisLivePosts(redis).getCommentCap("t3_alpha")).rejects.toThrow(
            new TypeError('Comment cap for post t3_alpha is not a number: "150"'),
        );
    });

    it("forgets a retired post's comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).forgetCommentCap("t3_alpha");

        expect(redis.del).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha");
    });
});
