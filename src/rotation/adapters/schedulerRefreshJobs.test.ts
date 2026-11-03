import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME, schedulerRefreshJobs } from "./schedulerRefreshJobs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const RUN_AT = new Date("2026-04-22T00:00:00Z");
const EARLIER_RUN_AT = new Date("2026-04-21T12:00:00Z");

describe(schedulerRefreshJobs, (): void => {
    it("cancels pending refresh jobs only", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { scheduler } = createFakeDevvitContext();
        scheduler.listJobs.mockResolvedValue([
            { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
            { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
            { id: "other-1", name: "keep-me", data: undefined, runAt: RUN_AT },
        ]);

        await schedulerRefreshJobs(scheduler).cancelAll();

        expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("refresh-1");
    });

    it(
        "replaces pending refreshes by scheduling the new one first, under the name src/main.ts registers",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { scheduler } = createFakeDevvitContext();
            const runAt = new Date("2026-04-21T10:00:01Z");
            scheduler.runJob.mockResolvedValue("refresh-new");
            scheduler.listJobs.mockResolvedValue([
                { id: "refresh-old", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
                { id: "refresh-new", name: REFRESH_JOB_NAME, data: undefined, runAt },
                { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
            ]);

            await schedulerRefreshJobs(scheduler).replaceWith(runAt);

            expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith({ name: "RefreshStickyPosts", runAt });
            expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("refresh-old");
            expect(scheduler.runJob).toHaveBeenCalledBefore(scheduler.cancelJob);
        },
    );

    it(
        "lists when pending refreshes are due, earliest first, ignoring the refresh check and other jobs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { scheduler } = createFakeDevvitContext();
            scheduler.listJobs.mockResolvedValue([
                { id: "refresh-2", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
                { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
                { id: "other-1", name: "keep-me", data: undefined, runAt: EARLIER_RUN_AT },
                { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt: EARLIER_RUN_AT },
            ]);

            await expect(schedulerRefreshJobs(scheduler).pendingRunTimes()).resolves.toStrictEqual([
                EARLIER_RUN_AT,
                RUN_AT,
            ]);
        },
    );

    it("tells whether the hourly refresh check is scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { scheduler } = createFakeDevvitContext();
        const refreshJobs = schedulerRefreshJobs(scheduler);
        scheduler.listJobs.mockResolvedValue([
            { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
        ]);
        const withoutCheck = await refreshJobs.hasHourlyCheck();
        scheduler.listJobs.mockResolvedValue([
            { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
        ]);

        expect(withoutCheck).toBe(false);
        await expect(refreshJobs.hasHourlyCheck()).resolves.toBe(true);
    });

    it(
        "replaces the hourly refresh check with one at minute 43 of every hour, leaving other jobs alone",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { scheduler } = createFakeDevvitContext();
            scheduler.listJobs.mockResolvedValue([
                { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
                { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
            ]);

            await schedulerRefreshJobs(scheduler).startHourlyCheck();

            expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("check-1");
            expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith({ name: "RefreshCheck", cron: "43 * * * *" });
        },
    );
});
