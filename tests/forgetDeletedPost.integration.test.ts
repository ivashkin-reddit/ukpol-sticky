import { redis } from "@devvit/web/server";
import { describe, expect } from "vitest";
import { rotationPorts } from "../src/composition.js";
import { forgetDeletedPost } from "../src/rotation/index.js";
import { HARNESS_CONTEXT } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

describe(forgetDeletedPost, (): void => {
    devvitIt(
        "forgets a deleted live post and its comment cap, keeping the others",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            await redis.hSet("StickyPostStore", { alpha: "t3_alpha", beta: "t3_beta" });
            await redis.set("CommentCap:t3_alpha", "150");
            await redis.set("CommentCap:t3_beta", "250");

            await forgetDeletedPost("t3_alpha", rotationPorts(HARNESS_CONTEXT).livePosts);

            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ beta: "t3_beta" });
            await expect(redis.get("CommentCap:t3_alpha")).resolves.toBeUndefined();
            await expect(redis.get("CommentCap:t3_beta")).resolves.toBe("250");
        },
    );

    devvitIt("ignores a deleted post that is not a live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        await redis.hSet("StickyPostStore", { beta: "t3_beta" });
        await redis.set("CommentCap:t3_other", "100");

        await forgetDeletedPost("t3_other", rotationPorts(HARNESS_CONTEXT).livePosts);

        await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ beta: "t3_beta" });
        await expect(redis.get("CommentCap:t3_other")).resolves.toBe("100");
    });
});
