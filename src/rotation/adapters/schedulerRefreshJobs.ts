import type { SchedulerPort } from "../../platform/index.js";
import type { PendingRefresh, RefreshJobs } from "../ports.js";

// Devvit's scheduler stores these job names, and each refresh job's data, with every scheduled job in installed
// subreddits; keep them stable. devvit.json declares a task under each name. A refresh job's data names its thread
// config as `configName`; jobs scheduled before refreshes were per thread config have none.
export const REFRESH_JOB_NAME = "RefreshStickyPosts";
export const REFRESH_CHECK_JOB_NAME = "RefreshCheck";

// Hourly, at a minute moderators are unlikely to pick as a post time, so the check rarely runs as a scheduled refresh
// starts. Cron times are UTC.
const REFRESH_CHECK_CRON = "43 * * * *";

export type RefreshScheduler = SchedulerPort<"cancelJob" | "listJobs" | "runJob">;

/** A job as listed, with the fields this adapter reads. */
type ListedJob = Readonly<{ id: string; name: string; data?: Readonly<Record<string, unknown>> | undefined }>;

/** The thread config a refresh job refreshes, if its data names one. */
function configNameOf(job: ListedJob): string | undefined {
    const configName = job.data?.["configName"];
    return typeof configName === "string" ? configName : undefined;
}

/** Picks the refresh jobs of the thread config named `configName`, or, when undefined, those that name none. */
function isRefreshOf(configName: string | undefined): (job: ListedJob) => boolean {
    return (job: ListedJob): boolean => job.name === REFRESH_JOB_NAME && configNameOf(job) === configName;
}

/** Cancels the jobs `cancels` picks. */
async function cancelJobs(scheduler: RefreshScheduler, cancels: (job: ListedJob) => boolean): Promise<void> {
    const jobs = await scheduler.listJobs();
    await Promise.all(
        jobs.filter(cancels).map(async (job: Readonly<{ id: string }>): Promise<void> => {
            await scheduler.cancelJob(job.id);
        }),
    );
}

function isPendingRefresh<Job extends Readonly<{ name: string }>>(job: Job): job is Job & Readonly<{ runAt: Date }> {
    return job.name === REFRESH_JOB_NAME && "runAt" in job;
}

async function listPending(scheduler: RefreshScheduler): Promise<readonly PendingRefresh[]> {
    const pending = (await scheduler.listJobs())
        .filter(isPendingRefresh)
        .map((job: ListedJob & Readonly<{ runAt: Date }>): PendingRefresh => ({
            configName: configNameOf(job),
            runAt: job.runAt,
        }));
    return pending.sort(
        (first: PendingRefresh, second: PendingRefresh): number => first.runAt.getTime() - second.runAt.getTime(),
    );
}

/** Refreshes as jobs in Devvit's scheduler, one per thread config, leaving any other jobs alone. */
export function schedulerRefreshJobs(scheduler: RefreshScheduler): RefreshJobs {
    return {
        pending: async (): Promise<readonly PendingRefresh[]> => await listPending(scheduler),
        replaceFor: async (configName: string, runAt: Date): Promise<void> => {
            const jobId = await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt, data: { configName } });
            const isOwn = isRefreshOf(configName);
            await cancelJobs(scheduler, (job: ListedJob): boolean => isOwn(job) && job.id !== jobId);
        },
        cancelFor: async (configName: string): Promise<void> => {
            await cancelJobs(scheduler, isRefreshOf(configName));
        },
        cancelUnassigned: async (): Promise<void> => {
            await cancelJobs(scheduler, isRefreshOf(undefined));
        },
        hasHourlyCheck: async (): Promise<boolean> =>
            (await scheduler.listJobs()).some(
                (job: Readonly<{ name: string }>): boolean => job.name === REFRESH_CHECK_JOB_NAME,
            ),
        startHourlyCheck: async (): Promise<void> => {
            await cancelJobs(scheduler, (job: ListedJob): boolean => job.name === REFRESH_CHECK_JOB_NAME);
            await scheduler.runJob({ name: REFRESH_CHECK_JOB_NAME, cron: REFRESH_CHECK_CRON });
        },
    };
}
