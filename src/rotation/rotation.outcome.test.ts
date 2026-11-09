import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    fullPost,
    LOOSE_CONFIG,
    PUBLISH_ERROR,
    STICKY_CONFIG,
    threadFailureAlert,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { refreshThreadConfig } from "./rotation.js";

// How a thread config's refresh reports how it went: its refresh status, its failure alert, and the hourly refresh
// check it keeps running.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

/** Fakes whose loose thread config has an up-to-date live post below its comment cap. */
function settledLooseThread(): FakeRotationPorts {
    const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
    fakes.livePosts.get.mockResolvedValue("t3_loose");
    fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });
    return fakes;
}

describe("refreshThreadConfig, reporting how it went", (): void => {
    it(
        "alerts moderators about the thread config when its refresh fails, and passes the failure on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

            await expect(refreshThreadConfig("sticky-thread", fakes.ports)).rejects.toBe(PUBLISH_ERROR);
            expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(
                threadFailureAlert("sticky-thread", "Reddit is down"),
            );
            expect(fakes.threadFailureAlert("sticky-thread").release).not.toHaveBeenCalled();
        },
    );

    it("restarts the hourly refresh check when a refresh finds it gone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        silenceConsole("error");
        const fakes = settledLooseThread();
        fakes.refreshJobs.hasHourlyCheck.mockResolvedValue(false);

        await refreshThreadConfig("loose-thread", fakes.ports);

        expect(fakes.refreshJobs.startHourlyCheck).toHaveBeenCalledExactlyOnceWith();
    });

    it("re-arms the thread config's failure alert once its refresh succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        silenceConsole("log");
        const fakes = settledLooseThread();

        await refreshThreadConfig("loose-thread", fakes.ports);

        expect(fakes.threadFailureAlert("loose-thread").release).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it(
        "records a successful refresh in the thread config's status, as of when it started",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T12:30:05Z");
            silenceConsole("log");
            const fakes = settledLooseThread();

            await refreshThreadConfig("loose-thread", fakes.ports);

            expect(fakes.refreshStatus.recordSuccess).toHaveBeenCalledExactlyOnceWith(
                "loose-thread",
                new Date("2026-04-21T12:30:05Z"),
            );
            expect(fakes.refreshStatus.recordFailure).not.toHaveBeenCalled();
        },
    );

    it("records a failed refresh with its failure", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T12:30:05Z");
        silenceConsole("log");
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);

        await expect(refreshThreadConfig("sticky-thread", fakes.ports)).rejects.toBe(PUBLISH_ERROR);
        expect(fakes.refreshStatus.recordFailure).toHaveBeenCalledExactlyOnceWith(
            "sticky-thread",
            new Date("2026-04-21T12:30:05Z"),
            "Reddit is down",
        );
    });

    it(
        "keeps the refresh's own failure when its status cannot record it, and logs that one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            const statusError = new Error("Redis is down");
            fakes.posts.publish.mockRejectedValue(PUBLISH_ERROR);
            fakes.refreshStatus.recordFailure.mockRejectedValue(statusError);

            await expect(refreshThreadConfig("sticky-thread", fakes.ports)).rejects.toBe(PUBLISH_ERROR);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Could not record the failed refresh of thread config sticky-thread in its refresh status:",
                statusError,
            );
        },
    );
});
