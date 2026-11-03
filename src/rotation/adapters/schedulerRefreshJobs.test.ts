import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { REFRESH_JOB_NAME, schedulerRefreshJobs } from "./schedulerRefreshJobs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(schedulerRefreshJobs, (): void => {
    it("cancels pending refresh jobs only", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { scheduler } = createFakeDevvitContext();
        const runAt = new Date("2026-04-22T00:00:00Z");
        scheduler.listJobs.mockResolvedValue([
            { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt },
            { id: "other-1", name: "keep-me", data: undefined, runAt },
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
});
