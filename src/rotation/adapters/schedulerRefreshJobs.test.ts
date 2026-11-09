import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME, schedulerRefreshJobs } from "./schedulerRefreshJobs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const RUN_AT = new Date("2026-04-22T00:00:00Z");
const EARLIER_RUN_AT = new Date("2026-04-21T12:00:00Z");
const CHECK_JOB = { id: "check-1", name: REFRESH_CHECK_JOB_NAME, data: undefined, cron: "43 * * * *" };

describe(schedulerRefreshJobs, (): void => {
    it(
        "lists pending refreshes with their thread configs, earliest first, ignoring other jobs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { scheduler } = createFakeDevvitContext();
            scheduler.listJobs.mockResolvedValue([
                { id: "daily-1", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
                CHECK_JOB,
                { id: "other-1", name: "keep-me", data: undefined, runAt: EARLIER_RUN_AT },
                { id: "old-1", name: REFRESH_JOB_NAME, data: undefined, runAt: EARLIER_RUN_AT },
            ]);

            await expect(schedulerRefreshJobs(scheduler).pending()).resolves.toStrictEqual([
                { configName: undefined, runAt: EARLIER_RUN_AT },
                { configName: "daily-thread", runAt: RUN_AT },
            ]);
        },
    );

    it(
        "reads a refresh whose data names no thread config as one from before the upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { scheduler } = createFakeDevvitContext();
            scheduler.listJobs.mockResolvedValue([
                { id: "odd-1", name: REFRESH_JOB_NAME, data: { configName: 42 }, runAt: RUN_AT },
            ]);

            await expect(schedulerRefreshJobs(scheduler).pending()).resolves.toStrictEqual([
                { configName: undefined, runAt: RUN_AT },
            ]);
        },
    );

    it(
        "replaces one thread config's refreshes by scheduling the new one first, leaving others' alone",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { scheduler } = createFakeDevvitContext();
            const runAt = new Date("2026-04-21T10:00:01Z");
            scheduler.runJob.mockResolvedValue("daily-new");
            scheduler.listJobs.mockResolvedValue([
                { id: "daily-old", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
                { id: "daily-new", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt },
                { id: "weekly-1", name: REFRESH_JOB_NAME, data: { configName: "weekly-thread" }, runAt: RUN_AT },
                { id: "old-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
                CHECK_JOB,
            ]);

            await schedulerRefreshJobs(scheduler).replaceFor("daily-thread", runAt);

            expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith({
                name: "RefreshStickyPosts",
                runAt,
                data: { configName: "daily-thread" },
            });
            expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("daily-old");
            expect(scheduler.runJob).toHaveBeenCalledBefore(scheduler.cancelJob);
        },
    );

    it("cancels one thread config's refreshes only", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { scheduler } = createFakeDevvitContext();
        scheduler.listJobs.mockResolvedValue([
            { id: "daily-1", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
            { id: "weekly-1", name: REFRESH_JOB_NAME, data: { configName: "weekly-thread" }, runAt: RUN_AT },
            { id: "old-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
        ]);

        await schedulerRefreshJobs(scheduler).cancelFor("daily-thread");

        expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("daily-1");
    });

    it("cancels the refreshes from before the upgrade only", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { scheduler } = createFakeDevvitContext();
        scheduler.listJobs.mockResolvedValue([
            { id: "daily-1", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
            { id: "old-1", name: REFRESH_JOB_NAME, data: undefined, runAt: RUN_AT },
            { id: "other-1", name: "keep-me", data: undefined, runAt: RUN_AT },
            CHECK_JOB,
        ]);

        await schedulerRefreshJobs(scheduler).cancelUnassigned();

        expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("old-1");
    });

    it("tells whether the hourly refresh check is scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { scheduler } = createFakeDevvitContext();
        const refreshJobs = schedulerRefreshJobs(scheduler);
        scheduler.listJobs.mockResolvedValue([
            { id: "daily-1", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
        ]);
        const withoutCheck = await refreshJobs.hasHourlyCheck();
        scheduler.listJobs.mockResolvedValue([CHECK_JOB]);

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
                CHECK_JOB,
                { id: "daily-1", name: REFRESH_JOB_NAME, data: { configName: "daily-thread" }, runAt: RUN_AT },
            ]);

            await schedulerRefreshJobs(scheduler).startHourlyCheck();

            expect(scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("check-1");
            expect(scheduler.runJob).toHaveBeenCalledExactlyOnceWith({ name: "RefreshCheck", cron: "43 * * * *" });
        },
    );
});
