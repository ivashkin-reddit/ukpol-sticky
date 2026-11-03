import { describe, expect, it, vi } from "vitest";
import { defer } from "../../tests/support/defer.js";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    DISABLED_CONFIG,
    failureAlert,
    fullPost,
    LOOSE_CONFIG,
    newPost,
    PUBLISH_ERROR,
    STICKY_CONFIG,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { ManagedPost } from "./ports.js";
import { refreshAllThreads } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const UNREADABLE_ERROR = new UnreadableConfigError("the stored thread configs cannot be read");

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
            expect(logSpy).toHaveBeenNthCalledWith(
                1,
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

        silenceConsole("error");
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

        await expect(refreshAllThreads(fakes.ports)).rejects.toThrow(
            new Error("Could not refresh thread config sticky-thread: Reddit is down"),
        );
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(
            failureAlert("Could not refresh thread config sticky-thread: Reddit is down"),
        );
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

    it("records a successful refresh, as of when it started", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T12:30:05Z");
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([]);

        await refreshAllThreads(fakes.ports);

        expect(fakes.refreshStatus.recordSuccess).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T12:30:05Z"));
        expect(fakes.refreshStatus.recordFailure).not.toHaveBeenCalled();
    });

    it("records a failed refresh with its failure", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T12:30:05Z");
        const fakes = createFakeRotationPorts();
        fakes.threadConfigs.mockRejectedValue(UNREADABLE_ERROR);

        await expect(refreshAllThreads(fakes.ports)).rejects.toBe(UNREADABLE_ERROR);
        expect(fakes.refreshStatus.recordFailure).toHaveBeenCalledExactlyOnceWith(
            new Date("2026-04-21T12:30:05Z"),
            "the stored thread configs cannot be read",
        );
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

        expect(logSpy).toHaveBeenLastCalledWith("Refresh finished for 2 thread configs: 1 published, 1 unchanged.");
    });

    it(
        "keeps refreshing the other thread configs when one fails, schedules a retry, then reports the failure",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            freezeTime("2026-04-21T10:00:00Z");
            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts([STICKY_CONFIG, LOOSE_CONFIG]);
            const postGone = new Error("post t3_gone not found");
            fakes.livePosts.get.mockImplementation(
                async (configName: string): Promise<string | undefined> =>
                    await Promise.resolve(configName === "sticky-thread" ? "t3_gone" : undefined),
            );
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_gone", "loose-thread": "t3_loose" });
            fakes.posts.get.mockRejectedValue(postGone);
            fakes.posts.publish.mockResolvedValue(newPost("t3_loose").post);

            await expect(refreshAllThreads(fakes.ports)).rejects.toThrow(
                new Error("Could not refresh thread config sticky-thread: post t3_gone not found"),
            );
            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({ title: "Loose thread", body: "Loose body" });
            // Neither fixture thread config has a schedule, so the retry is the next refresh.
            expect(fakes.refreshJobs.scheduleAt).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:15:05.000Z"));
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Could not refresh thread config sticky-thread:",
                postGone,
            );
        },
    );

    it(
        "records that no refresh is scheduled when no thread config is in force",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([]);

            await refreshAllThreads(fakes.ports);

            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
        },
    );

    it(
        "keeps the live post of a thread config added while it ran, reading the thread configs again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            fakes.livePosts.get.mockResolvedValue("t3_loose");
            fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });
            // Another invocation published the sticky thread config's live post after this refresh read the configs.
            fakes.livePosts.configNames.mockResolvedValue(["loose-thread", "sticky-thread"]);
            fakes.threadConfigs.mockResolvedValueOnce([LOOSE_CONFIG]).mockResolvedValue([LOOSE_CONFIG, STICKY_CONFIG]);

            await refreshAllThreads(fakes.ports);

            expect(fakes.livePosts.forget).not.toHaveBeenCalled();
        },
    );
});
