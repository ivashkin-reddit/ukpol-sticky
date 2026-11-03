import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { failureAlert, PUBLISH_ERROR, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import { refreshAllThreads } from "./rotation.js";

// How a refresh reports how it went: the refresh status, the failure alert, and the hourly refresh check it keeps
// running.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const UNREADABLE_ERROR = new UnreadableConfigError("the stored thread configs cannot be read");

describe("refreshAllThreads, reporting how it went", (): void => {
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

    it("restarts the hourly refresh check when a refresh finds it gone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        silenceConsole("error");
        const fakes = createFakeRotationPorts([]);
        fakes.refreshJobs.hasHourlyCheck.mockResolvedValue(false);

        await refreshAllThreads(fakes.ports);

        expect(fakes.refreshJobs.startHourlyCheck).toHaveBeenCalledExactlyOnceWith();
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

    it(
        "keeps the refresh's own failure when the refresh status cannot record it, and logs that one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts();
            const statusError = new Error("Redis is down");
            fakes.threadConfigs.mockRejectedValue(UNREADABLE_ERROR);
            fakes.refreshStatus.recordFailure.mockRejectedValue(statusError);

            await expect(refreshAllThreads(fakes.ports)).rejects.toBe(UNREADABLE_ERROR);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Could not record the failed refresh in the refresh status:",
                statusError,
            );
        },
    );

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
});
