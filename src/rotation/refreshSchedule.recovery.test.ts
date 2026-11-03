import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { ensureRefreshPending, keepRefreshCheckRunning, scheduleRetry, startRefreshCheck } from "./refreshSchedule.js";

// What keeps refreshes running when something goes wrong: the hourly refresh check, which requests a refresh when none
// will run; retries of a failed thread config; and every refresh restarting the hourly check if it has gone.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

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
