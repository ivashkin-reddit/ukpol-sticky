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

/** Cancels the jobs named `name`, except the one with the ID `keepJobId`. */
async function cancelJobsNamed(scheduler: RefreshScheduler, name: string, keepJobId?: string): Promise<void> {
    const jobs = await scheduler.listJobs();
    await Promise.all(
        jobs
            .filter((job: Readonly<{ id: string; name: string }>): boolean => job.name === name && job.id !== keepJobId)
            .map(async (job: Readonly<{ id: string }>): Promise<void> => {
                await scheduler.cancelJob(job.id);
            }),
    );
}

function isPendingRefresh<Job extends Readonly<{ name: string }>>(job: Job): job is Job & Readonly<{ runAt: Date }> {
    return job.name === REFRESH_JOB_NAME && "runAt" in job;
}

async function listPendingRunTimes(scheduler: RefreshScheduler): Promise<readonly Date[]> {
    const runTimes = (await scheduler.listJobs())
        .filter(isPendingRefresh)
        .map((job: Readonly<{ runAt: Date }>): Date => job.runAt);
    return runTimes.sort((first: Date, second: Date): number => first.getTime() - second.getTime());
}

/** Refreshes as jobs in Devvit's scheduler, leaving any other jobs alone. */
export function schedulerRefreshJobs(scheduler: RefreshScheduler): RefreshJobs {
    return {
        pendingRunTimes: async (): Promise<readonly Date[]> => await listPendingRunTimes(scheduler),
        replaceWith: async (runAt: Date): Promise<void> => {
            const jobId = await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt });
            await cancelJobsNamed(scheduler, REFRESH_JOB_NAME, jobId);
        },
        cancelAll: async (): Promise<void> => {
            await cancelJobsNamed(scheduler, REFRESH_JOB_NAME);
        },
        hasHourlyCheck: async (): Promise<boolean> =>
            (await scheduler.listJobs()).some(
                (job: Readonly<{ name: string }>): boolean => job.name === REFRESH_CHECK_JOB_NAME,
            ),
        startHourlyCheck: async (): Promise<void> => {
            await cancelJobsNamed(scheduler, REFRESH_CHECK_JOB_NAME);
            await scheduler.runJob({ name: REFRESH_CHECK_JOB_NAME, cron: REFRESH_CHECK_CRON });
        },
    };
}
