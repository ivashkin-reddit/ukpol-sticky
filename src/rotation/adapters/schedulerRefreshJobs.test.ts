import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME, schedulerRefreshJobs } from "./schedulerRefreshJobs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const RUN_AT = new Date("2026-04-22T00:00:00Z");

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

    it("schedules a refresh job under the name src/main.ts registers", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { scheduler } = createFakeDevvitContext();
        const runAt = new Date("2026-04-21T10:00:01Z");

        await schedulerRefreshJobs(scheduler).scheduleAt(runAt);

        expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith({ name: "RefreshStickyPosts", runAt });
    });

    it("finds a pending refresh, ignoring the refresh check and other jobs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { scheduler } = createFakeDevvitContext();
        scheduler.listJobs.mockResolvedValue([
            { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" },
            { id: "other-1", name: "keep-me", data: undefined, runAt: RUN_AT },
        ]);
        const refreshJobs = schedulerRefreshJobs(scheduler);
        const pendingWithoutRefresh = await refreshJobs.isPending();
        scheduler.listJobs.mockResolvedValue([
            { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
        ]);

        expect(pendingWithoutRefresh).toBe(false);
        await expect(refreshJobs.isPending()).resolves.toBe(true);
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
