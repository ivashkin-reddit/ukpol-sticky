import { describe, expect, it, vi } from "vitest";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { DISABLED_CONFIG, LOOSE_CONFIG, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { findManagingThread, holdLivePostLock } from "./managedPosts.js";
import type { Handover } from "./ports.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const LIVE_POSTS = { "sticky-thread": "t3_sticky", "disabled-thread": "t3_disabled" };

function livePostsReturning(
    livePosts: Readonly<Record<string, string>>,
): Readonly<{ all: () => Promise<Readonly<Record<string, string>>> }> {
    return { all: async (): Promise<Readonly<Record<string, string>>> => await Promise.resolve(livePosts) };
}

describe(holdLivePostLock, (): void => {
    it("runs for a post no thread config manages, taking no lock", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([STICKY_CONFIG], livePostsReturning(LIVE_POSTS));

        await expect(
            holdLivePostLock("t3_other", async (): Promise<string> => await Promise.resolve("done"), fakes.ports),
        ).resolves.toStrictEqual({ kind: "ran", result: "done" });
        expect(fakes.threadLocks.tryLock).not.toHaveBeenCalled();
    });

    it(
        "holds the lock of the thread config whose live post it is, and releases it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts([STICKY_CONFIG], livePostsReturning(LIVE_POSTS));
            const run = vi.fn<() => Promise<string>>().mockResolvedValue("done");

            await expect(holdLivePostLock("t3_sticky", run, fakes.ports)).resolves.toStrictEqual({
                kind: "ran",
                result: "done",
            });
            expect(fakes.threadLocks.tryLock).toHaveBeenCalledBefore(run);
            expect(fakes.threadLocks.unlock).toHaveBeenCalledExactlyOnceWith("sticky-thread");
        },
    );

    it("releases the lock when the run fails, passing the failure on", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([STICKY_CONFIG], livePostsReturning(LIVE_POSTS));
        const failure = new Error("Reddit is down");

        await expect(
            holdLivePostLock("t3_sticky", async (): Promise<string> => await Promise.reject(failure), fakes.ports),
        ).rejects.toBe(failure);
        expect(fakes.threadLocks.unlock).toHaveBeenCalledExactlyOnceWith("sticky-thread");
    });

    it("is busy, and runs nothing, while another holds the lock", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([STICKY_CONFIG], livePostsReturning(LIVE_POSTS));
        await fakes.ports.threadLocks.tryLock("sticky-thread");
        const run = vi.fn<() => Promise<string>>().mockResolvedValue("done");

        await expect(holdLivePostLock("t3_sticky", run, fakes.ports)).resolves.toStrictEqual({ kind: "busy" });
        expect(run).not.toHaveBeenCalled();
    });

    it.for(["t3_new", "t3_old"])(
        "counts the post %s of an unfinished handover as its thread config's",
        TEST_OPTIONS,
        async (postId: string): Promise<void> => {
            expect.assertions(1);

            const fakes = createFakeRotationPorts([STICKY_CONFIG], {
                handovers: async (): Promise<Readonly<Record<string, Handover>>> =>
                    await Promise.resolve({ "sticky-thread": { newPostId: "t3_new", oldPostId: "t3_old" } }),
            });

            await holdLivePostLock(postId, async (): Promise<string> => await Promise.resolve("done"), fakes.ports);

            expect(fakes.threadLocks.tryLock).toHaveBeenCalledExactlyOnceWith("sticky-thread");
        },
    );
});

describe(findManagingThread, (): void => {
    it("finds the enabled thread config whose live post it is, with its pin", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts([STICKY_CONFIG, DISABLED_CONFIG], livePostsReturning(LIVE_POSTS));

        await expect(findManagingThread("t3_sticky", fakes.ports)).resolves.toStrictEqual({
            configName: "sticky-thread",
            pin: { kind: "keepSlot" },
        });
    });

    it.for(["t3_other", "t3_disabled"])(
        "finds none for %s, which no enabled thread config has live",
        TEST_OPTIONS,
        async (postId: string): Promise<void> => {
            expect.assertions(1);

            const fakes = createFakeRotationPorts([LOOSE_CONFIG, DISABLED_CONFIG], livePostsReturning(LIVE_POSTS));

            await expect(findManagingThread(postId, fakes.ports)).resolves.toBeUndefined();
        },
    );
});
