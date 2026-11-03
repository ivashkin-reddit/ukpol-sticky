import { describe, expect, it } from "vitest";
import { createFakeRotationContext } from "../../tests/support/fakeRotationContext.js";
import { getCommentCap } from "./livePosts.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(getCommentCap, (): void => {
    it("returns undefined when no cap is stored for the post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationContext();

        await expect(getCommentCap("t3_alpha", fakes.context)).resolves.toBeUndefined();
        expect(fakes.redis.get).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha");
    });

    it("returns the stored cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationContext();
        fakes.redis.get.mockResolvedValue("150");

        await expect(getCommentCap("t3_alpha", fakes.context)).resolves.toBe(150);
    });

    it("throws when the stored cap is not a number", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationContext();
        fakes.redis.get.mockResolvedValue('"150"');

        await expect(getCommentCap("t3_alpha", fakes.context)).rejects.toThrow(
            new TypeError('Comment cap for post t3_alpha is not a number: "150"'),
        );
    });
});
