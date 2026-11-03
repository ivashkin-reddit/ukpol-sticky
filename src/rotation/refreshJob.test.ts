import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationContext } from "../../tests/support/fakeRotationContext.js";
import { REFRESH_JOB_NAME, requestRefresh } from "./refreshJob.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(requestRefresh, (): void => {
    it(
        "cancels pending refreshes only, then schedules one a second from now",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = createFakeRotationContext();
            const runAt = new Date("2026-04-22T00:00:00Z");
            fakes.scheduler.listJobs.mockResolvedValue([
                { id: "refresh-1", name: REFRESH_JOB_NAME, data: undefined, runAt },
                { id: "other-1", name: "keep-me", data: undefined, runAt },
            ]);

            await requestRefresh(fakes.context);

            expect(fakes.scheduler.cancelJob).toHaveBeenCalledExactlyOnceWith("refresh-1");
            expect(fakes.scheduler.runJob).toHaveBeenCalledExactlyOnceWith({
                name: REFRESH_JOB_NAME,
                runAt: new Date("2026-04-21T10:00:01.000Z"),
            });
        },
    );
});
