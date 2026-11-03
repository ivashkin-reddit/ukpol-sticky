import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakePost, createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { RefreshStatus } from "./ports.js";
import {
    ensureRefreshPending,
    getRefreshStatus,
    requestRefresh,
    scheduleNextRefresh,
    startRefreshCheck,
} from "./refreshSchedule.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(scheduleNextRefresh, (): void => {
    it(
        "fails without cancelling pending refreshes when the thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeRotationPorts();
            const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");
            fakes.threadConfigs.mockRejectedValue(unreadable);

            await expect(scheduleNextRefresh(fakes.ports)).rejects.toThrow(unreadable);
            expect(fakes.refreshJobs.cancelAll).not.toHaveBeenCalled();
        },
    );
});

describe(requestRefresh, (): void => {
    it(
        "cancels pending refreshes, then schedules one a second from now and records it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = createFakeRotationPorts();

            await requestRefresh(fakes.ports);

            expect(fakes.refreshJobs.scheduleAt).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:00:01.000Z"));
            expect(fakes.refreshJobs.cancelAll).toHaveBeenCalledBefore(fakes.refreshJobs.scheduleAt);
            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(
                new Date("2026-04-21T10:00:01.000Z"),
            );
        },
    );
});

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
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        await ensureRefreshPending(fakes.ports);

        expect(fakes.refreshJobs.cancelAll).not.toHaveBeenCalled();
        expect(fakes.refreshJobs.scheduleAt).not.toHaveBeenCalled();
    });

    it("requests a refresh a second from now when none is pending", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T10:43:00Z");
        const logSpy = silenceConsole("log");
        const fakes = createFakeRotationPorts();
        fakes.refreshJobs.isPending.mockResolvedValue(false);

        await ensureRefreshPending(fakes.ports);

        expect(fakes.refreshJobs.scheduleAt).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:43:01.000Z"));
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No refresh is pending, so the refresh check requested one.");
    });

    it("alerts moderators when the check itself fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        const schedulerError = new Error("scheduler unavailable");
        fakes.refreshJobs.isPending.mockRejectedValue(schedulerError);

        await expect(ensureRefreshPending(fakes.ports)).rejects.toBe(schedulerError);
        expect(fakes.notifyModerators.mock.lastCall?.[0].subject).toBe("Sticky Manager could not refresh its threads");
    });
});

describe("scheduleNextRefresh and the refresh status", (): void => {
    it("records when the next refresh is due", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        const fakes = createFakeRotationPorts([
            {
                name: "daily-thread",
                enabled: true,
                title: "Daily",
                frequency: "daily",
                postTime: "12:30",
                maxComments: 100,
                body: "Body",
            },
        ]);
        fakes.livePosts.all.mockResolvedValue({ "daily-thread": "t3_daily" });
        fakes.posts.get.mockResolvedValue(
            createFakePost({
                body: "Body",
                createdAt: new Date("2026-04-21T05:00:00Z"),
                id: "t3_daily",
                numberOfComments: 0,
                stickied: true,
            }).post,
        );

        await scheduleNextRefresh(fakes.ports);

        expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(
            new Date("2026-04-21T12:30:05.000Z"),
        );
    });

    it(
        "records that no refresh is scheduled when no live post has a schedule",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = createFakeRotationPorts();

            await scheduleNextRefresh(fakes.ports);

            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
        },
    );
});

describe(getRefreshStatus, (): void => {
    it("reads the recorded refresh status", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        const status: RefreshStatus = {
            lastRefresh: { at: new Date("2026-04-21T12:30:05Z"), outcome: "failed", failure: "Reddit is down" },
            lastSuccessAt: new Date("2026-04-20T12:30:05Z"),
            nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
        };
        fakes.refreshStatus.read.mockResolvedValue(status);

        await expect(getRefreshStatus(fakes.ports.refreshStatus)).resolves.toBe(status);
    });
});
