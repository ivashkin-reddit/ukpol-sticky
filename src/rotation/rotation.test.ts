import { describe, expect, it } from "vitest";
import { unlabelled } from "../../tests/support/fakeHighlights.js";
import { findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    DISABLED_CONFIG,
    fullPost,
    LOOSE_CONFIG,
    newPost,
    STICKY_CONFIG,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import { refreshThreadConfig } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(refreshThreadConfig, (): void => {
    it(
        "publishes a live post for a thread config without one, pinned as it asks",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            const stickyPost = newPost("t3_sticky");
            fakes.posts.publish.mockResolvedValue(stickyPost.post);
            fakes.posts.get.mockImplementation(findingPostsById([stickyPost.post]));

            await refreshThreadConfig("sticky-thread", fakes.ports);

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({
                title: "Sticky thread",
                body: "Sticky body",
            });
            expect(fakes.highlights.current()).toStrictEqual([{ postId: "t3_sticky", label: "megathread" }]);
        },
    );

    it("rotates a live post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        silenceConsole("log");
        const fakes = createFakeRotationPorts([STICKY_CONFIG], {}, unlabelled("t3_full"));
        fakes.livePosts.get.mockResolvedValue("t3_full");
        const next = newPost("t3_next").post;
        fakes.posts.get.mockImplementation(findingPostsById([fullPost("t3_full", 100).post, next]));
        fakes.posts.publish.mockResolvedValue(next);

        await refreshThreadConfig("sticky-thread", fakes.ports);

        expect(fakes.highlights.current()).toStrictEqual([{ postId: "t3_next", label: "megathread" }]);
        expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({ title: "Sticky thread", body: "Sticky body" });
        expect(fakes.livePosts.set).toHaveBeenCalledExactlyOnceWith("sticky-thread", "t3_next");
    });

    it(
        "brings the body of a live post that is not due up to date and renews its comment cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeRotationPorts([{ ...STICKY_CONFIG, body: "New body" }]);
            fakes.livePosts.get.mockResolvedValue("t3_live");
            const live = fullPost("t3_live", 10);
            fakes.posts.get.mockResolvedValue(live.post);

            await refreshThreadConfig("sticky-thread", fakes.ports);

            expect(live.edit).toHaveBeenCalledExactlyOnceWith({ text: "New body" });
            expect(fakes.livePosts.storeCommentCap).toHaveBeenCalledExactlyOnceWith("t3_live", 100);
            expect(fakes.posts.publish).not.toHaveBeenCalled();
        },
    );

    it("logs what the refresh did", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
        fakes.livePosts.get.mockResolvedValue("t3_loose");
        fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });

        await refreshThreadConfig("loose-thread", fakes.ports);

        expect(logSpy).toHaveBeenCalledWith("Refresh of thread config loose-thread finished: unchanged.");
    });

    it("forgets a thread config no longer in force instead of refreshing it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts([DISABLED_CONFIG]);
        fakes.livePosts.all.mockResolvedValue({ "disabled-thread": "t3_disabled" });

        await refreshThreadConfig("disabled-thread", fakes.ports);

        expect(fakes.livePosts.forget).toHaveBeenCalledExactlyOnceWith(["disabled-thread"], ["t3_disabled"]);
        expect(fakes.posts.publish).not.toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "Thread config disabled-thread is no longer in force, so it is forgotten.",
        );
    });

    it("fails, touching nothing, when the thread configs cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeRotationPorts();
        const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");
        fakes.threadConfigs.mockRejectedValue(unreadable);

        await expect(refreshThreadConfig("sticky-thread", fakes.ports)).rejects.toThrow(unreadable);
        expect(fakes.livePosts.forget).not.toHaveBeenCalled();
        // Configuration alerts moderators to unreadable thread configs itself.
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it(
        "leaves recording and scheduling to the invocation already refreshing the thread config",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.threadLocks.tryLock.mockResolvedValue(false);

            await refreshThreadConfig("sticky-thread", fakes.ports);

            expect(fakes.appliedThreadConfigs.record).not.toHaveBeenCalled();
            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
            expect(fakes.refreshStatus.recordSuccess).not.toHaveBeenCalled();
        },
    );
});
