import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { DAILY_CONFIG, LOOSE_CONFIG, refreshFailureAlert } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { PendingRefresh } from "./ports.js";
import { checkRefreshes } from "./refreshCheck.js";

// The hourly refresh check: each thread config in force keeps the refresh it needs pending and on time.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const REQUESTED_AT = new Date("2026-04-21T10:43:01.000Z");

function pendingAt(configName: string | undefined, isoTime: string): PendingRefresh {
    return { configName, runAt: new Date(isoTime) };
}

/** At 10:43, fakes over `configs`, each with a live post, and `pending` as the pending refreshes. */
function checkedAt(configs: readonly ThreadConfig[], pending: readonly PendingRefresh[]): FakeRotationPorts {
    freezeTime("2026-04-21T10:43:00Z");
    const fakes = createFakeRotationPorts(configs);
    fakes.livePosts.all.mockResolvedValue(
        Object.fromEntries(configs.map((config): readonly [string, string] => [config.name, `t3_${config.name}`])),
    );
    fakes.refreshJobs.pending.mockResolvedValue(pending);
    return fakes;
}

describe(checkRefreshes, (): void => {
    it(
        "leaves an on-time refresh alone, and restates every pending refresh in one line",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = silenceConsole("log");
            const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T12:30:05Z")]);

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refreshes: 2026-04-21T12:30:05.000Z for thread config daily-thread.",
            );
        },
    );

    it(
        "groups refreshes due at the same time, including one from before the upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const logSpy = silenceConsole("log");
            const configs = ["wc-01", "wc-02", "regular-mt"].map((name): ThreadConfig => ({ ...DAILY_CONFIG, name }));
            const fakes = checkedAt(configs, [
                pendingAt("regular-mt", "2026-04-21T16:05:05Z"),
                pendingAt(undefined, "2026-04-21T16:05:05Z"),
                pendingAt("wc-01", "2026-04-22T08:05:05Z"),
                pendingAt("wc-02", "2026-04-22T08:05:05Z"),
            ]);

            await checkRefreshes(fakes.ports);

            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refreshes: 2026-04-21T16:05:05.000Z for thread config regular-mt and every thread config; 2026-04-22T08:05:05.000Z for thread configs wc-01, wc-02.",
            );
        },
    );

    it("logs that no refresh is pending", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const logSpy = silenceConsole("log");
        const fakes = checkedAt([], []);

        await checkRefreshes(fakes.ports);

        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No refreshes are pending.");
    });

    it(
        "requests a refresh of a thread config with a schedule and none pending, and logs it as an error",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const fakes = checkedAt([DAILY_CONFIG], []);

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith("daily-thread", REQUESTED_AT);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Requested a refresh of thread config daily-thread: no refresh of it was pending.",
            );
        },
    );

    it("replaces a refresh more than ten minutes past its time", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        silenceConsole("log");
        const errorSpy = silenceConsole("error");
        const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T10:30:00Z")]);

        await checkRefreshes(fakes.ports);

        expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith("daily-thread", REQUESTED_AT);
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "The refresh of thread config daily-thread due at 2026-04-21T10:30:00.000Z has not run, so the refresh check replaced it.",
        );
    });

    it(
        "leaves alone a refresh only a few minutes late, which Devvit may still run",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T10:35:00Z")]);

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );

    it(
        "requests a refresh of a thread config whose live post was removed, and logs it as expected",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = silenceConsole("log");
            const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T12:30:05Z")]);
            fakes.livePosts.all.mockResolvedValue({});

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith("daily-thread", REQUESTED_AT);
            expect(logSpy).toHaveBeenCalledWith(
                "Requested a refresh of thread config daily-thread: it has no live post.",
            );
        },
    );

    it(
        "leaves a pending retry alone for a thread config that needs a refresh now",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = checkedAt([LOOSE_CONFIG], [pendingAt("loose-thread", "2026-04-21T10:55:05Z")]);
            fakes.livePosts.all.mockResolvedValue({});

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );

    it(
        "requests a refresh when the stored thread config was never applied and no refresh of it is due soon",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const fakes = checkedAt(
                [{ ...DAILY_CONFIG, body: "Edited body" }],
                [pendingAt("daily-thread", "2026-04-21T12:30:05Z")],
            );
            await fakes.ports.appliedThreadConfigs.record(DAILY_CONFIG);

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith("daily-thread", REQUESTED_AT);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Requested a refresh of thread config daily-thread: its stored thread config was never applied, and no refresh of it was due.",
            );
        },
    );

    it(
        "requests a refresh to finish an unfinished handover with no retry pending",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T12:30:05Z")]);
            fakes.livePosts.handovers.mockResolvedValue({ "daily-thread": { newPostId: "t3_daily-thread" } });

            await checkRefreshes(fakes.ports);

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Requested a refresh of thread config daily-thread: its handover is unfinished, and no retry of it was pending.",
            );
        },
    );

    it(
        "needs nothing pending for a thread config with a live post and no schedule",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = checkedAt([LOOSE_CONFIG], []);

            await checkRefreshes(fakes.ports);

            expect(fakes.refreshJobs.replaceFor).not.toHaveBeenCalled();
        },
    );

    it("forgets thread configs no longer in force", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T12:30:05Z")]);
        fakes.livePosts.configNames.mockResolvedValue(["daily-thread", "gone-thread"]);

        await checkRefreshes(fakes.ports);

        expect(fakes.appliedThreadConfigs.forget).toHaveBeenCalledExactlyOnceWith(["gone-thread"]);
    });

    it(
        "checks the other thread configs when one fails, then fails naming it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const redisError = new Error("redis unavailable");
            const fakes = checkedAt([DAILY_CONFIG, LOOSE_CONFIG], []);
            fakes.livePosts.all.mockResolvedValue({ "daily-thread": "t3_daily" });
            fakes.appliedThreadConfigs.matches.mockImplementation(
                async (config: ThreadConfig): Promise<boolean> =>
                    await (config.name === "daily-thread" ? Promise.reject(redisError) : Promise.resolve(true)),
            );

            await expect(checkRefreshes(fakes.ports)).rejects.toThrow(
                new Error("Could not check thread config daily-thread: redis unavailable"),
            );
            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith("loose-thread", REQUESTED_AT);
            expect(errorSpy).toHaveBeenCalledWith(
                "The refresh check could not check thread config daily-thread:",
                redisError,
            );
        },
    );

    it("alerts moderators under the general alert when the check fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = checkedAt([DAILY_CONFIG], []);
        const schedulerError = new Error("scheduler unavailable");
        fakes.refreshJobs.pending.mockRejectedValue(schedulerError);

        await expect(checkRefreshes(fakes.ports)).rejects.toBe(schedulerError);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(refreshFailureAlert("scheduler unavailable"));
    });

    it("re-arms the general alert once a check succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const fakes = checkedAt([DAILY_CONFIG], [pendingAt("daily-thread", "2026-04-21T12:30:05Z")]);

        await checkRefreshes(fakes.ports);

        expect(fakes.refreshFailureAlert.release).toHaveBeenCalledExactlyOnceWith();
    });
});
