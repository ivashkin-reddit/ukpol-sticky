import { describe, expect, it } from "vitest";
import { freezeTime } from "../../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisLivePosts } from "./redisLivePosts.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisLivePosts, (): void => {
    it("reads live posts from the StickyPostStore hash", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        const livePosts = redisLivePosts(redis);
        await livePosts.all();
        await livePosts.get("alpha");

        expect(redis.hGetAll).toHaveBeenCalledExactlyOnceWith("StickyPostStore");
        expect(redis.hGet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", "alpha");
    });

    it(
        "names the thread configs with a live post or an unfinished handover, each once",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { redis } = createFakeDevvitContext();
            redis.hKeys.mockImplementation(
                async (key: string): Promise<string[]> =>
                    await Promise.resolve(key === "StickyPostStore" ? ["alpha", "beta"] : ["beta", "gamma"]),
            );

            await expect(redisLivePosts(redis).configNames()).resolves.toStrictEqual(["alpha", "beta", "gamma"]);
        },
    );

    it("records a live post in the StickyPostStore hash", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).set("alpha", "t3_alpha");

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", { alpha: "t3_alpha" });
    });

    it(
        "forgets live posts, their unfinished handovers and the comment caps of the given posts",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { redis } = createFakeDevvitContext();
            await redisLivePosts(redis).forget(["alpha", "beta"], ["t3_alpha", "t3_beta"]);

            expect(redis.hDel).toHaveBeenNthCalledWith(1, "StickyPostStore", ["alpha", "beta"]);
            expect(redis.hDel).toHaveBeenNthCalledWith(2, "PendingHandovers", ["alpha", "beta"]);
            expect(redis.del).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha", "CommentCap:t3_beta");
        },
    );

    it("deletes no comment cap when no post is given", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).forget(["alpha"], []);

        expect(redis.hDel).toHaveBeenCalledWith("StickyPostStore", ["alpha"]);
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

describe("redisLivePosts() handovers", (): void => {
    it("saves a handover as JSON in the PendingHandovers hash", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).saveHandover("alpha", {
            newPostId: "t3_new",
            oldPostId: "t3_old",
            endNoteId: "t1_note",
        });

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("PendingHandovers", {
            alpha: JSON.stringify({ newPostId: "t3_new", oldPostId: "t3_old", endNoteId: "t1_note" }),
        });
    });

    it("reads every unfinished handover back", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        redis.hGetAll.mockResolvedValue({
            alpha: JSON.stringify({ newPostId: "t3_new" }),
            beta: JSON.stringify({ newPostId: "t3_b2", oldPostId: "t3_b1", endNoteId: "t1_b" }),
        });

        await expect(redisLivePosts(redis).handovers()).resolves.toStrictEqual({
            alpha: { newPostId: "t3_new" },
            beta: { newPostId: "t3_b2", oldPostId: "t3_b1", endNoteId: "t1_b" },
        });
        expect(redis.hGetAll).toHaveBeenCalledExactlyOnceWith("PendingHandovers");
    });

    it("forgets a finished handover", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisLivePosts(redis).forgetHandover("alpha");

        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("PendingHandovers", ["alpha"]);
    });

    it("rejects a stored handover that is not one, naming its thread config", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        redis.hGetAll.mockResolvedValue({ alpha: JSON.stringify({ newPostId: 5 }) });

        await expect(redisLivePosts(redis).handovers()).rejects.toThrow(
            new TypeError('The stored handover of thread config alpha is not a handover: {"newPostId":5}'),
        );
    });
});
