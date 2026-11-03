import { addSeconds } from "date-fns";
import type { SchedulerPort } from "../platform/index.js";

/** Devvit's scheduler stores this name with every scheduled refresh in installed subreddits; keep it stable. */
export const REFRESH_JOB_NAME = "RefreshStickyPosts";
const REQUESTED_REFRESH_DELAY_SECONDS = 1;

export type RefreshJobContext = Readonly<{ scheduler: SchedulerPort<"cancelJob" | "listJobs" | "runJob"> }>;

export async function cancelRefreshJobs(context: RefreshJobContext): Promise<void> {
    const jobs = await context.scheduler.listJobs();
    await Promise.all(
        jobs
            .filter((job: Readonly<{ name: string }>): boolean => job.name === REFRESH_JOB_NAME)
            .map(async (job: Readonly<{ id: string }>): Promise<void> => {
                await context.scheduler.cancelJob(job.id);
            }),
    );
}

export async function scheduleRefresh(context: RefreshJobContext, runAt: Date): Promise<void> {
    await context.scheduler.runJob({ name: REFRESH_JOB_NAME, runAt });
}

/** Replaces any pending refresh with one a second from now, e.g. to apply newly stored thread configs. */
export async function requestRefresh(context: RefreshJobContext): Promise<void> {
    await cancelRefreshJobs(context);
    await scheduleRefresh(context, addSeconds(new Date(), REQUESTED_REFRESH_DELAY_SECONDS));
}
