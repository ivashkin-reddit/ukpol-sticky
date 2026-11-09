import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    commentOn,
    fullPost,
    newPost,
    PUBLISH_ERROR,
    STICKY_CONFIG,
    threadFailureAlert,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { forgetDeletedPost, rotateIfCapReached } from "./rotation.js";

// Rotation's response to events on posts: a comment that may reach a live post's comment cap, and a deleted post.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(rotateIfCapReached, (): void => {
    it("does nothing for a post without a stored comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();

        await rotateIfCapReached(commentOn("t3_other"), fakes.ports);

        expect(fakes.livePosts.getCommentCap).toHaveBeenCalledExactlyOnceWith("t3_other");
        expect(fakes.posts.get).not.toHaveBeenCalled();
    });

    it("leaves a live post below its comment cap alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 99).post);

        await rotateIfCapReached(commentOn("t3_full"), fakes.ports);

        expect(fakes.posts.get).toHaveBeenCalledExactlyOnceWith("t3_full");
        expect(fakes.posts.publish).not.toHaveBeenCalled();
    });

    it("rotates a live post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.livePosts.get.mockResolvedValue("t3_full");
        const full = fullPost("t3_full", 100);
        fakes.posts.get.mockResolvedValue(full.post);
        fakes.posts.publish.mockResolvedValue(newPost("t3_next").post);

        await rotateIfCapReached(commentOn("t3_full"), fakes.ports);

        expect(logSpy).toHaveBeenNthCalledWith(1, "Post t3_full has reached its comment cap of 100.");
        expect(full.unsticky).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.livePosts.set).toHaveBeenCalledExactlyOnceWith("sticky-thread", "t3_next");
    });

    it("alerts moderators when the rotation at the comment cap fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.livePosts.get.mockResolvedValue("t3_full");
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);
        fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

        await expect(rotateIfCapReached(commentOn("t3_full"), fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(
            threadFailureAlert("sticky-thread", "Reddit is down"),
        );
    });
});

describe("rotateIfCapReached and the comment count its event reports", (): void => {
    it(
        "spares the Reddit read for a comment its event shows clearly below the comment cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.livePosts.getCommentCap.mockResolvedValue(100);

            await rotateIfCapReached(commentOn("t3_full", 50), fakes.ports);

            expect(fakes.posts.get).not.toHaveBeenCalled();
        },
    );

    it(
        "reads the post itself, and rotates it, when its event shows it within a comment of the cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.livePosts.getCommentCap.mockResolvedValue(100);
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
            fakes.livePosts.get.mockResolvedValue("t3_full");
            fakes.posts.get.mockImplementation(
                findingPostsById([fullPost("t3_full", 100).post, newPost("t3_next").post]),
            );
            fakes.posts.publish.mockResolvedValue(newPost("t3_next").post);

            await rotateIfCapReached(commentOn("t3_full", 99), fakes.ports);

            expect(fakes.posts.get).toHaveBeenNthCalledWith(1, "t3_full");
            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({
                title: "Sticky thread",
                body: "Sticky body",
            });
        },
    );
});

describe("rotateIfCapReached, beyond the comment cap itself", (): void => {
    it("leaves a disabled thread config's live post alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([{ ...STICKY_CONFIG, enabled: false }]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);

        await rotateIfCapReached(commentOn("t3_full"), fakes.ports);

        expect(fakes.posts.publish).not.toHaveBeenCalled();
    });

    it("schedules a retry fifteen minutes on when the rotation fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T10:00:00Z");
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.livePosts.get.mockResolvedValue("t3_full");
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);
        fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

        await expect(rotateIfCapReached(commentOn("t3_full"), fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
            "sticky-thread",
            new Date("2026-04-21T10:15:05.000Z"),
        );
    });

    it(
        "leaves the retry to an earlier refresh already pending, so failures do not reschedule one by one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.livePosts.getCommentCap.mockResolvedValue(100);
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
            fakes.livePosts.get.mockResolvedValue("t3_full");
            fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);
            fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);
            fakes.refreshJobs.pending.mockResolvedValue([
                { configName: "sticky-thread", runAt: new Date("2026-04-21T10:15:05Z") },
            ]);

            await expect(rotateIfCapReached(commentOn("t3_full"), fakes.ports)).rejects.toBe(PUBLISH_ERROR);
            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );

    it("leaves scheduling to the invocation already rotating the thread", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);
        fakes.threadLocks.tryLock.mockResolvedValue(false);

        await rotateIfCapReached(commentOn("t3_full"), fakes.ports);

        expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        expect(fakes.refreshJobs.cancelFor).not.toHaveBeenCalled();
    });

    it(
        "keeps the rotation's own failure when its retry cannot be scheduled, and logs that one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            const schedulerError = new Error("scheduler unavailable");
            fakes.livePosts.getCommentCap.mockResolvedValue(100);
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
            fakes.livePosts.get.mockResolvedValue("t3_full");
            fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);
            fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);
            fakes.refreshJobs.pending.mockRejectedValue(schedulerError);

            await expect(rotateIfCapReached(commentOn("t3_full"), fakes.ports)).rejects.toBe(PUBLISH_ERROR);
            expect(errorSpy).toHaveBeenLastCalledWith(
                "Could not schedule a retry of thread config sticky-thread; the hourly refresh check requests a refresh if none is pending:",
                schedulerError,
            );
        },
    );
});

describe(forgetDeletedPost, (): void => {
    it(
        "forgets a deleted live post and its comment cap, and logs that the refresh check replaces it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts();
            fakes.livePosts.all.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

            await forgetDeletedPost("t3_alpha", fakes.ports.livePosts);

            expect(fakes.livePosts.forget).toHaveBeenCalledExactlyOnceWith(["alpha"], ["t3_alpha"]);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Live post t3_alpha of thread config alpha was removed or deleted, so it is forgotten; the next refresh check, within the hour, publishes its replacement.",
            );
        },
    );

    it("ignores a deleted post that is not a live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        fakes.livePosts.all.mockResolvedValue({ beta: "t3_beta" });

        await forgetDeletedPost("t3_other", fakes.ports.livePosts);

        expect(fakes.livePosts.forget).not.toHaveBeenCalled();
    });

    it(
        "stops a handover retiring a deleted post, which needs no end note or lock",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts();
            fakes.livePosts.all.mockResolvedValue({ alpha: "t3_new" });
            fakes.livePosts.handovers.mockResolvedValue({
                alpha: { newPostId: "t3_new", oldPostId: "t3_old", endNoteId: "t1_note" },
            });

            await forgetDeletedPost("t3_old", fakes.ports.livePosts);

            expect(fakes.livePosts.saveHandover).toHaveBeenCalledExactlyOnceWith("alpha", { newPostId: "t3_new" });
            expect(fakes.livePosts.forget).not.toHaveBeenCalled();
        },
    );

    it("forgets a handover whose new post was deleted", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts();
        // Its rotation stopped before recording the new post as live.
        fakes.livePosts.handovers.mockResolvedValue({ alpha: { newPostId: "t3_new", oldPostId: "t3_old" } });

        await forgetDeletedPost("t3_new", fakes.ports.livePosts);

        expect(fakes.livePosts.forgetHandover).toHaveBeenCalledExactlyOnceWith("alpha");
    });
});
