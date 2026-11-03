import type { SchedulerPort } from "../../platform/index.js";
import type { RefreshJobs } from "../ports.js";

/**
 * Devvit's scheduler stores this name with every scheduled refresh in installed subreddits; keep it stable.
 * src/main.ts registers the refresh handler under it.
 */
export const REFRESH_JOB_NAME = "RefreshStickyPosts";

export type RefreshScheduler = SchedulerPort<"cancelJob" | "listJobs" | "runJob">;

async function cancelAll(scheduler: RefreshScheduler): Promise<void> {
    const jobs = await scheduler.listJobs();
    await Promise.all(
        jobs
            .filter((job: Readonly<{ name: string }>): boolean => job.name === REFRESH_JOB_NAME)
            .map(async (job: Readonly<{ id: string }>): Promise<void> => {
                await scheduler.cancelJob(job.id);
            }),
    );
}

/** Refreshes as jobs in Devvit's scheduler, leaving any other jobs alone. */
export function schedulerRefreshJobs(scheduler: RefreshScheduler): RefreshJobs {
    return {
        cancelAll: async (): Promise<void> => {
            await cancelAll(scheduler);
        },
        scheduleAt: async (runAt: Date): Promise<void> => {
            await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt });
        },
    };
}
