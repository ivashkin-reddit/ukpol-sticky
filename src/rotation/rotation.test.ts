import { describe, expect, it, vi } from "vitest";
import { defer } from "../../tests/support/defer.js";
import { createFakePost, createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { ManagedPost } from "./ports.js";
import { forgetDeletedPost, refreshAllThreads, rotateIfCapReached } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const STICKY_CONFIG: ThreadConfig = {
    name: "sticky-thread",
    enabled: true,
    title: "Sticky thread",
    maxComments: 100,
    body: "Sticky body",
    sticky: true,
};
const LOOSE_CONFIG: ThreadConfig = {
    name: "loose-thread",
    enabled: true,
    title: "Loose thread",
    maxComments: 100,
    body: "Loose body",
};
const DISABLED_CONFIG: ThreadConfig = {
    name: "disabled-thread",
    enabled: false,
    title: "Disabled thread",
    maxComments: 100,
    body: "Disabled body",
};

const UNREADABLE_ERROR = new UnreadableConfigError("the stored thread configs cannot be read");
const PUBLISH_ERROR = new Error("Reddit is down");
const FAILURE_ALERT = {
    subject: "Sticky Manager could not refresh its threads",
    bodyMarkdown: [
        "A refresh of the managed threads failed. A thread that was rotating may have lost its live post: the old one unstickied and locked, with no replacement yet.",
        "Sticky Manager tries again within the hour, and sends no further alert until a refresh succeeds.",
        "Details: Reddit is down",
    ].join("\n\n"),
};

function newPost(id: string): ReturnType<typeof createFakePost> {
    return createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id,
        numberOfComments: 0,
        stickied: false,
    });
}

function fullPost(id: string, numberOfComments: number): ReturnType<typeof createFakePost> {
    return createFakePost({
        body: "Sticky body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id,
        numberOfComments,
        stickied: true,
    });
}

describe(refreshAllThreads, (): void => {
    it(
        "forgets every live post and its comment cap when no thread config is in force",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([]);
            fakes.livePosts.all.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

            await refreshAllThreads(fakes.ports);

            expect(fakes.livePosts.forget).toHaveBeenCalledExactlyOnceWith(["alpha", "beta"], ["t3_alpha", "t3_beta"]);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "No thread configs are in force, so every live post is forgotten.",
            );
        },
    );

    it(
        "fails and keeps every live post when the thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeRotationPorts();
            fakes.threadConfigs.mockRejectedValue(UNREADABLE_ERROR);
            fakes.livePosts.all.mockResolvedValue({ alpha: "t3_alpha" });

            await expect(refreshAllThreads(fakes.ports)).rejects.toThrow(UNREADABLE_ERROR);
            expect(fakes.livePosts.forget).not.toHaveBeenCalled();
            expect(fakes.posts.publish).not.toHaveBeenCalled();
            // Configuration alerts moderators to unreadable thread configs itself.
            expect(fakes.refreshFailureAlert.claim).not.toHaveBeenCalled();
        },
    );

    it("alerts moderators when a refresh fails, and passes the failure on", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

        await expect(refreshAllThreads(fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(FAILURE_ALERT);
        expect(fakes.refreshFailureAlert.release).not.toHaveBeenCalled();
    });

    it("re-arms the failure alert once a refresh succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([]);

        await refreshAllThreads(fakes.ports);

        expect(fakes.refreshFailureAlert.release).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it(
        "publishes live posts for enabled thread configs one at a time, sticky first",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([LOOSE_CONFIG, DISABLED_CONFIG, STICKY_CONFIG]);
            const stickyPost = newPost("t3_sticky");
            const loosePost = newPost("t3_loose");
            const stickySubmission = defer<ManagedPost>();
            fakes.posts.publish.mockReturnValueOnce(stickySubmission.promise).mockResolvedValueOnce(loosePost.post);

            const refresh = refreshAllThreads(fakes.ports);
            // While the sticky post's submission is pending, no other post may be published.
            await vi.waitFor((): void => {
                expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({
                    title: "Sticky thread",
                    body: "Sticky body",
                });
            });
            stickySubmission.resolve(stickyPost.post);
            await refresh;

            expect(fakes.posts.publish).toHaveBeenNthCalledWith(2, { title: "Loose thread", body: "Loose body" });
            expect(fakes.posts.publish).toHaveBeenCalledTimes(2);
            expect(stickyPost.sticky).toHaveBeenCalledExactlyOnceWith();
            expect(loosePost.sticky).not.toHaveBeenCalled();
        },
    );

    it("rotates a live post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.get.mockResolvedValue("t3_full");
        const full = fullPost("t3_full", 100);
        fakes.posts.get.mockResolvedValue(full.post);
        fakes.posts.publish.mockResolvedValue(newPost("t3_next").post);

        await refreshAllThreads(fakes.ports);

        expect(full.unsticky).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({ title: "Sticky thread", body: "Sticky body" });
        expect(fakes.livePosts.set).toHaveBeenCalledExactlyOnceWith("sticky-thread", "t3_next");
    });

    it(
        "brings the body of a live post that is not due up to date and renews its comment cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([{ ...STICKY_CONFIG, body: "New body" }]);
            fakes.livePosts.get.mockResolvedValue("t3_live");
            const live = fullPost("t3_live", 10);
            fakes.posts.get.mockResolvedValue(live.post);

            await refreshAllThreads(fakes.ports);

            expect(live.edit).toHaveBeenCalledExactlyOnceWith({ text: "New body" });
            expect(fakes.livePosts.storeCommentCap).toHaveBeenCalledExactlyOnceWith("t3_live", 100);
            expect(fakes.posts.publish).not.toHaveBeenCalled();
        },
    );

    it("logs what the refresh did for each thread config", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG, LOOSE_CONFIG]);
        // The sticky thread has no live post yet; the loose one has an up-to-date live post below its comment cap.
        fakes.livePosts.get.mockImplementation(
            async (configName: string): Promise<string | undefined> =>
                await Promise.resolve(configName === "loose-thread" ? "t3_loose" : undefined),
        );
        fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });
        fakes.posts.publish.mockResolvedValue(newPost("t3_sticky").post);

        await refreshAllThreads(fakes.ports);

        expect(logSpy).toHaveBeenLastCalledWith(
            "Refresh complete for 2 thread configs: 0 rotated, 1 published, 0 updated, 1 unchanged.",
        );
    });
});

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
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(FAILURE_ALERT);
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
