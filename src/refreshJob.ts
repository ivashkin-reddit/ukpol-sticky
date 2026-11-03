import { REFRESH_STICKY_POSTS_JOB } from "./constants.js";
import type { SchedulerPort } from "./ports.js";

export type RefreshJobContext = Readonly<{ scheduler: SchedulerPort<"cancelJob" | "listJobs" | "runJob"> }>;

export async function cancelRefreshJobs(context: RefreshJobContext): Promise<void> {
    const jobs = await context.scheduler.listJobs();
    await Promise.all(
        jobs
            .filter((job: Readonly<{ name: string }>): boolean => job.name === REFRESH_STICKY_POSTS_JOB)
            .map(async (job: Readonly<{ id: string }>): Promise<void> => {
                await context.scheduler.cancelJob(job.id);
            }),
    );
}

export async function scheduleRefresh(context: RefreshJobContext, runAt: Date): Promise<void> {
    await context.scheduler.runJob({ name: REFRESH_STICKY_POSTS_JOB, runAt });
}
