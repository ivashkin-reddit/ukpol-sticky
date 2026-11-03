import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { failureAlert, fullPost, newPost, PUBLISH_ERROR, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { forgetDeletedPost, rotateIfCapReached } from "./rotation.js";

// Rotation's response to events on posts: a comment that may reach a live post's comment cap, and a deleted post.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(rotateIfCapReached, (): void => {
    it("does nothing for a post without a stored comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();

        await rotateIfCapReached("t3_other", fakes.ports);

        expect(fakes.livePosts.getCommentCap).toHaveBeenCalledExactlyOnceWith("t3_other");
        expect(fakes.posts.get).not.toHaveBeenCalled();
    });

    it("leaves a live post below its comment cap alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 99).post);

        await rotateIfCapReached("t3_full", fakes.ports);

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

        await rotateIfCapReached("t3_full", fakes.ports);

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

        await expect(rotateIfCapReached("t3_full", fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(failureAlert("Reddit is down"));
    });
});

describe("rotateIfCapReached, beyond the comment cap itself", (): void => {
    it("leaves a disabled thread config's live post alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([{ ...STICKY_CONFIG, enabled: false }]);
        fakes.livePosts.getCommentCap.mockResolvedValue(100);
        fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.posts.get.mockResolvedValue(fullPost("t3_full", 100).post);

        await rotateIfCapReached("t3_full", fakes.ports);

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

        await expect(rotateIfCapReached("t3_full", fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.refreshJobs.scheduleAt).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:15:05.000Z"));
    });
});

describe(forgetDeletedPost, (): void => {
    it("forgets a deleted live post and its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        fakes.livePosts.all.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

        await forgetDeletedPost("t3_alpha", fakes.ports.livePosts);

        expect(fakes.livePosts.forget).toHaveBeenCalledExactlyOnceWith(["alpha"], ["t3_alpha"]);
    });

    it("ignores a deleted post that is not a live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        fakes.livePosts.all.mockResolvedValue({ beta: "t3_beta" });

        await forgetDeletedPost("t3_other", fakes.ports.livePosts);

        expect(fakes.livePosts.forget).not.toHaveBeenCalled();
    });
});
