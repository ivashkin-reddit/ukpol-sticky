import { getConfig } from "./config.js";
import { refreshStickyPosts } from "./stickyManager.js";
import { vi } from "vitest";

test("getConfig returns an empty array when stored JSON is invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const context = {
        redis: {
            get: vi.fn().mockResolvedValue("{"),
        },
    };

    await expect(getConfig(context as never)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("refreshStickyPosts clears tracked posts when config is empty", async () => {
    const redis = {
        get: vi.fn().mockResolvedValue("[]"),
        hGetAll: vi.fn().mockResolvedValue({
            alpha: "t3_alpha",
            beta: "t3_beta",
        }),
        hDel: vi.fn().mockResolvedValue(undefined),
        del: vi.fn().mockResolvedValue(undefined),
    };

    const context = {
        redis,
    };

    await refreshStickyPosts({} as never, context as never);

    expect(redis.hDel).toHaveBeenCalledWith("StickyPostStore", ["alpha", "beta"]);
    expect(redis.del).toHaveBeenNthCalledWith(1, "CommentCap:t3_alpha");
    expect(redis.del).toHaveBeenNthCalledWith(2, "CommentCap:t3_beta");
});
