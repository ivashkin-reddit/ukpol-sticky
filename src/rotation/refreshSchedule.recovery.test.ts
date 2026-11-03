import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { LOOSE_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import { ensureRefreshPending, keepRefreshCheckRunning, scheduleRetry, startRefreshCheck } from "./refreshSchedule.js";

// What keeps refreshes running when something goes wrong: the hourly refresh check, which requests a refresh when none
// will run; retries of a failed thread config; and every refresh restarting the hourly check if it has gone.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const UNREADABLE_ERROR = new UnreadableConfigError("the stored thread configs cannot be read");

describe(startRefreshCheck, (): void => {
    it("starts the hourly refresh check", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        await startRefreshCheck(fakes.ports.refreshJobs);

        expect(fakes.refreshJobs.startHourlyCheck).toHaveBeenCalledExactlyOnceWith();
    });
});

describe(ensureRefreshPending, (): void => {
    it("leaves a pending refresh alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        await ensureRefreshPending(fakes.ports);

        expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
    });

    it(
        "leaves alone a refresh only a few minutes late, which the scheduler may still run",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:43:00Z");
            const fakes = createFakeRotationPorts();
            fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date("2026-04-21T10:35:00Z")]);

            await ensureRefreshPending(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
        },
    );

    it("requests a refresh a second from now when none is pending", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T10:43:00Z");
        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.pendingRunTimes.mockResolvedValue([]);

        await ensureRefreshPending(fakes.ports);

        expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:43:01.000Z"));
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No refresh is pending, so the refresh check requested one.");
    });

    it(
        "replaces a refresh more than ten minutes past its time, which the scheduler has not run, and logs it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:43:00Z");
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts();
            fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date("2026-04-21T10:30:00Z")]);

            await ensureRefreshPending(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:43:01.000Z"));
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "The refresh due at 2026-04-21T10:30:00.000Z has not run, so the refresh check replaced it.",
            );
        },
    );

    it("alerts moderators when the check itself fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        const schedulerError = new Error("scheduler unavailable");
        fakes.refreshJobs.pendingRunTimes.mockRejectedValue(schedulerError);

        await expect(ensureRefreshPending(fakes.ports)).rejects.toBe(schedulerError);
        expect(fakes.notifyModerators.mock.lastCall?.[0].subject).toBe("Sticky Manager could not refresh its threads");
    });
});

describe("ensureRefreshPending with thread configs stored since the last refresh", (): void => {
    it.for(["2100-01-01T00:00:00Z", "2026-04-21T10:43:06Z"])(
        "requests a refresh when the pending one, due %s, is not due at once, and logs it",
        TEST_OPTIONS,
        async (pendingAt: string): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:43:00Z");
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            await fakes.ports.appliedThreadConfigs.record([]);
            fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date(pendingAt)]);

            await ensureRefreshPending(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:43:01.000Z"));
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Thread configs stored since the last refresh had no refresh due at once, so the refresh check requested one.",
            );
        },
    );

    it.for(["2026-04-21T10:43:05Z", "2026-04-21T10:42:00Z"])(
        "leaves alone a pending refresh due at once (%s), as their save requested",
        TEST_OPTIONS,
        async (pendingAt: string): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:43:00Z");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            await fakes.ports.appliedThreadConfigs.record([]);
            fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date(pendingAt)]);

            await ensureRefreshPending(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
        },
    );

    it(
        "keeps a refresh pending when none is, before reading the thread configs, so unreadable ones cannot stop it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:43:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts();
            fakes.refreshJobs.pendingRunTimes.mockResolvedValue([]);
            fakes.threadConfigs.mockRejectedValue(UNREADABLE_ERROR);

            await ensureRefreshPending(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:43:01.000Z"));
        },
    );

    it(
        "fails, keeping the pending refresh and leaving the alert to configuration, when the thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts();
            fakes.threadConfigs.mockRejectedValue(UNREADABLE_ERROR);

            await expect(ensureRefreshPending(fakes.ports)).rejects.toBe(UNREADABLE_ERROR);
            expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
            expect(fakes.refreshFailureAlert.claim).not.toHaveBeenCalled();
        },
    );
});

describe(scheduleRetry, (): void => {
    it("leaves the retry to an earlier refresh already pending", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date("2026-04-21T10:05:00Z")]);

        await scheduleRetry(fakes.ports, "daily-thread");

        expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
    });

    it("schedules the retry when the pending refresh is later", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date("2026-04-21T12:30:00Z")]);

        await scheduleRetry(fakes.ports, "daily-thread");

        expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:15:05.000Z"));
    });

    it("schedules the retry when the earlier pending refresh is stuck", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.pendingRunTimes.mockResolvedValue([new Date("2026-04-21T09:00:00Z")]);

        await scheduleRetry(fakes.ports, "daily-thread");

        expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:15:05.000Z"));
    });
});

describe(keepRefreshCheckRunning, (): void => {
    it("restarts the hourly refresh check when it has gone, and logs it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const errorSpy = silenceConsole("error");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.hasHourlyCheck.mockResolvedValue(false);

        await keepRefreshCheckRunning(fakes.ports.refreshJobs);

        expect(fakes.refreshJobs.startHourlyCheck).toHaveBeenCalledExactlyOnceWith();
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "The hourly refresh check was missing, so it was started again.",
        );
    });

    it("leaves a scheduled hourly refresh check alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        await keepRefreshCheckRunning(fakes.ports.refreshJobs);

        expect(fakes.refreshJobs.startHourlyCheck).not.toHaveBeenCalled();
    });
});
