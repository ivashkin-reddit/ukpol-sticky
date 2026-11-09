import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { DAILY_CONFIG, dailyPost, DISABLED_CONFIG, LOOSE_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { RefreshStatus } from "./ports.js";
import {
    getRefreshStatus,
    keepRefreshCheckRunning,
    scheduleNextRefresh,
    scheduleRetry,
    startRefreshCheck,
} from "./refreshSchedule.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

/** Fakes over `configs`, with the daily thread config's live post t3_daily published at 05:00 and due at 12:30. */
function dailyThread(configs: readonly ThreadConfig[] = [DAILY_CONFIG]): FakeRotationPorts {
    const fakes = createFakeRotationPorts(configs);
    fakes.livePosts.get.mockResolvedValue("t3_daily");
    fakes.posts.get.mockResolvedValue(dailyPost("t3_daily").post);
    return fakes;
}

describe(scheduleNextRefresh, (): void => {
    it(
        "replaces the thread config's refreshes with one five seconds after its rotation time, records and logs it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            const fakes = dailyThread();

            await scheduleNextRefresh("daily-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "daily-thread",
                new Date("2026-04-21T12:30:05.000Z"),
            );
            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(
                "daily-thread",
                new Date("2026-04-21T12:30:05.000Z"),
            );
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refresh of thread config daily-thread scheduled for 2026-04-21T12:30:05.000Z, to rotate it.",
            );
        },
    );

    it(
        "schedules a refresh at once while the stored thread config is not the one its last refresh applied",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            const fakes = dailyThread([{ ...DAILY_CONFIG, body: "Edited body" }]);
            await fakes.ports.appliedThreadConfigs.record(DAILY_CONFIG);

            await scheduleNextRefresh("daily-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "daily-thread",
                new Date("2026-04-21T10:00:05.000Z"),
            );
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refresh of thread config daily-thread scheduled for 2026-04-21T10:00:05.000Z, to apply its stored thread config.",
            );
        },
    );

    it("schedules a refresh at once to publish a missing live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts([LOOSE_CONFIG]);

        await scheduleNextRefresh("loose-thread", fakes.ports);

        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "Next refresh of thread config loose-thread scheduled for 2026-04-21T10:00:05.000Z, to publish its live post.",
        );
    });

    it("schedules a refresh at once to finish an unfinished handover", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const logSpy = silenceConsole("log");
        const fakes = dailyThread();
        fakes.livePosts.handovers.mockResolvedValue({ "daily-thread": { newPostId: "t3_daily" } });

        await scheduleNextRefresh("daily-thread", fakes.ports);

        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "Next refresh of thread config daily-thread scheduled for 2026-04-21T10:00:05.000Z, to finish its handover.",
        );
    });

    it(
        "cancels the refreshes of a thread config with a live post and no schedule, and logs why",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            fakes.livePosts.get.mockResolvedValue("t3_loose");

            await scheduleNextRefresh("loose-thread", fakes.ports);

            expect(fakes.refreshJobs.cancelFor).toHaveBeenCalledExactlyOnceWith("loose-thread");
            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith("loose-thread", undefined);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Thread config loose-thread has no schedule, so only its comment cap rotates it.",
            );
        },
    );

    it("forgets a thread config no longer in force instead", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts([DISABLED_CONFIG]);

        await scheduleNextRefresh("disabled-thread", fakes.ports);

        expect(fakes.appliedThreadConfigs.forget).toHaveBeenCalledExactlyOnceWith(["disabled-thread"]);
        expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
    });

    it(
        "fails without touching pending refreshes when the thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts();
            const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");
            fakes.threadConfigs.mockRejectedValue(unreadable);

            await expect(scheduleNextRefresh("daily-thread", fakes.ports)).rejects.toThrow(unreadable);
            expect(fakes.refreshJobs.cancelFor).not.toHaveBeenCalled();
            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );
});

describe(scheduleRetry, (): void => {
    it(
        "retries the thread config fifteen minutes on, leaving its overdue rotation time out",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T13:00:00Z");
            const logSpy = silenceConsole("log");
            const fakes = dailyThread();

            await scheduleRetry("daily-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "daily-thread",
                new Date("2026-04-21T13:15:05.000Z"),
            );
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refresh of thread config daily-thread scheduled for 2026-04-21T13:15:05.000Z, to retry it after a failure.",
            );
        },
    );

    it(
        "leaves the retry to a refresh of the thread config already due within the retry delay",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T13:00:00Z");
            const fakes = dailyThread();
            fakes.refreshJobs.pending.mockResolvedValue([
                { configName: "daily-thread", runAt: new Date("2026-04-21T13:15:05Z") },
            ]);

            await scheduleRetry("daily-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );

    it.for<readonly [string | undefined, string]>([
        ["weekly-thread", "2026-04-21T13:05:00Z"],
        ["daily-thread", "2026-04-21T12:40:00Z"],
        // The failed refresh's own job: the scheduler lists a job until it has run, and this one is still running.
        ["daily-thread", "2026-04-21T12:59:57Z"],
    ])(
        "schedules the retry when the refresh due soon is another's, stuck or the failed one's own (%s at %s)",
        TEST_OPTIONS,
        async ([configName, runAt]): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T13:00:00Z");
            silenceConsole("log");
            const fakes = dailyThread();
            fakes.refreshJobs.pending.mockResolvedValue([{ configName, runAt: new Date(runAt) }]);

            await scheduleRetry("daily-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "daily-thread",
                new Date("2026-04-21T13:15:05.000Z"),
            );
        },
    );
});

describe("the hourly refresh check's upkeep", (): void => {
    it("starts the hourly refresh check", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        await startRefreshCheck(fakes.ports.refreshJobs);

        expect(fakes.refreshJobs.startHourlyCheck).toHaveBeenCalledExactlyOnceWith();
    });

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

describe(getRefreshStatus, (): void => {
    it("reads the named thread configs' recorded refresh status", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        const status: RefreshStatus = {
            lastRefresh: { at: new Date("2026-04-21T12:30:05Z"), outcome: "failed", failure: "Reddit is down" },
            lastSuccessAt: new Date("2026-04-20T12:30:05Z"),
            nextRefreshAt: new Date("2026-04-21T12:45:05Z"),
        };
        const statuses = { "daily-thread": status };
        fakes.refreshStatus.read.mockResolvedValue(statuses);

        await expect(getRefreshStatus(fakes.ports.refreshStatus, ["daily-thread"])).resolves.toBe(statuses);
        expect(fakes.refreshStatus.read).toHaveBeenCalledExactlyOnceWith(["daily-thread"]);
    });
});
