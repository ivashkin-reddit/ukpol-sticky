import type { SchedulerPort } from "../../platform/index.js";
import type { RefreshJobs } from "../ports.js";

// Devvit's scheduler stores these job names with every scheduled job in installed subreddits; keep them stable.
// src/main.ts registers a handler under each.
export const REFRESH_JOB_NAME = "RefreshStickyPosts";
export const REFRESH_CHECK_JOB_NAME = "RefreshCheck";

// Hourly, at a minute moderators are unlikely to pick as a post time, so the check rarely runs as a scheduled refresh
// starts. Cron times are UTC.
const REFRESH_CHECK_CRON = "43 * * * *";

export type RefreshScheduler = SchedulerPort<"cancelJob" | "listJobs" | "runJob">;

async function cancelJobsNamed(scheduler: RefreshScheduler, name: string): Promise<void> {
    const jobs = await scheduler.listJobs();
    await Promise.all(
        jobs
            .filter((job: Readonly<{ name: string }>): boolean => job.name === name)
            .map(async (job: Readonly<{ id: string }>): Promise<void> => {
                await scheduler.cancelJob(job.id);
            }),
    );
}

/** Refreshes as jobs in Devvit's scheduler, leaving any other jobs alone. */
export function schedulerRefreshJobs(scheduler: RefreshScheduler): RefreshJobs {
    return {
        cancelAll: async (): Promise<void> => {
            await cancelJobsNamed(scheduler, REFRESH_JOB_NAME);
        },
        scheduleAt: async (runAt: Date): Promise<void> => {
            await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt });
        },
        isPending: async (): Promise<boolean> =>
            (await scheduler.listJobs()).some(
                (job: Readonly<{ name: string }>): boolean => job.name === REFRESH_JOB_NAME,
            ),
        startHourlyCheck: async (): Promise<void> => {
            await cancelJobsNamed(scheduler, REFRESH_CHECK_JOB_NAME);
            await scheduler.runJob({ name: REFRESH_CHECK_JOB_NAME, cron: REFRESH_CHECK_CRON });
        },
    };
}
