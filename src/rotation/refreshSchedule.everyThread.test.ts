import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    DAILY_CONFIG,
    dailyPost,
    DISABLED_CONFIG,
    LOOSE_CONFIG,
    refreshFailureAlert,
    STICKY_CONFIG,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { requestEveryThreadRefresh, scheduleEveryThreadRefresh } from "./refreshSchedule.js";

// Refreshes of every thread config: those a config page save requests, and the scheduling at the upgrade.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const STORED_CONFIGS = "thread configs stored since the last refresh";

describe(requestEveryThreadRefresh, (): void => {
    it(
        "requests a refresh of every thread config in force a second from now, and logs them in one line",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG, DISABLED_CONFIG, STICKY_CONFIG]);
            fakes.refreshJobs.pending.mockResolvedValue([]);
            const refreshAt = new Date("2026-04-21T10:00:01.000Z");

            await requestEveryThreadRefresh(fakes.ports, STORED_CONFIGS);

            expect(fakes.refreshJobs.replaceFor.mock.calls).toStrictEqual([
                ["sticky-thread", refreshAt],
                ["loose-thread", refreshAt],
            ]);
            expect(fakes.refreshStatus.recordNextRefresh.mock.calls).toStrictEqual([
                ["sticky-thread", { at: refreshAt, reason: "requested" }],
                ["loose-thread", { at: refreshAt, reason: "requested" }],
            ]);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Requested a refresh of thread configs sticky-thread, loose-thread: thread configs stored since the last refresh.",
            );
        },
    );

    it(
        "keeps a thread config's refresh already due at once, so repeated saves add no jobs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG, LOOSE_CONFIG]);
            fakes.refreshJobs.pending.mockResolvedValue([
                { configName: "sticky-thread", runAt: new Date("2026-04-21T10:00:01Z") },
            ]);

            await requestEveryThreadRefresh(fakes.ports, STORED_CONFIGS);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "loose-thread",
                new Date("2026-04-21T10:00:01.000Z"),
            );
        },
    );

    it("forgets the thread configs no longer in force", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        fakes.livePosts.configNames.mockResolvedValue(["sticky-thread", "gone-thread"]);

        await requestEveryThreadRefresh(fakes.ports, STORED_CONFIGS);

        expect(fakes.appliedThreadConfigs.forget).toHaveBeenCalledExactlyOnceWith(["gone-thread"]);
    });

    it("logs that no thread config is in force", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts([]);

        await requestEveryThreadRefresh(fakes.ports, STORED_CONFIGS);

        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No thread configs are in force, so no refresh is requested.");
    });

    it(
        "alerts moderators, under the general alert, when it cannot request the refreshes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            const schedulerError = new Error("scheduler unavailable");
            fakes.refreshJobs.pending.mockRejectedValue(schedulerError);

            await expect(requestEveryThreadRefresh(fakes.ports, STORED_CONFIGS)).rejects.toBe(schedulerError);
            expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(
                refreshFailureAlert("scheduler unavailable"),
            );
        },
    );
});

describe(scheduleEveryThreadRefresh, (): void => {
    it(
        "schedules each thread config in force, then cancels the refreshes from before the upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts([DAILY_CONFIG, LOOSE_CONFIG]);
            fakes.livePosts.get.mockImplementation(
                async (configName: string): Promise<string | undefined> =>
                    await Promise.resolve(configName === "daily-thread" ? "t3_daily" : undefined),
            );
            fakes.posts.get.mockResolvedValue(dailyPost("t3_daily").post);

            await scheduleEveryThreadRefresh(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledWith(
                "daily-thread",
                new Date("2026-04-21T12:30:05.000Z"),
            );
            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledWith(
                "loose-thread",
                new Date("2026-04-21T10:00:05.000Z"),
            );
            expect(fakes.refreshJobs.cancelUnassigned).toHaveBeenCalledAfter(fakes.refreshJobs.replaceFor);
        },
    );
});
