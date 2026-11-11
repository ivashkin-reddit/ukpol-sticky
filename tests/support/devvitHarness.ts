import { reddit, redis, scheduler } from "@devvit/web/server";
import type { ScheduledCronJob, ScheduledJob } from "@devvit/web/server";
import type { T1 } from "@devvit/web/shared";
import { vi } from "vitest";
import type { RotationContext } from "../../src/composition.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME } from "../../src/rotation/adapters/schedulerRefreshJobs.js";
import type { ManagedComment, ManagedPost } from "../../src/rotation/index.js";
import { harnessPost, harnessSubreddit } from "./harnessHighlights.js";

/** createDevvitTest()'s default subreddit and app, as its request context names them. */
export const TEST_SUBREDDIT_ID = "t5_testsub";
export const TEST_SUBREDDIT_NAME = "testsub";
export const TEST_APP_SLUG = "test-app";

/**
 * Devvit's in-memory test harness, as the composition root builds rotation ports from it, with stand-ins for the
 * highlight calls the harness does not implement (see harnessHighlights.ts).
 */
export const HARNESS_CONTEXT: RotationContext = {
    reddit: {
        modMail: reddit.modMail,
        getCommentById: async (id: T1): Promise<ManagedComment> => await reddit.getCommentById(id),
        getCurrentSubreddit: harnessSubreddit,
        getPostById: harnessPost,
        submitPost: async (options: Parameters<RotationContext["reddit"]["submitPost"]>[0]): Promise<ManagedPost> =>
            await reddit.submitPost(options),
    },
    redis,
    scheduler,
    subredditId: TEST_SUBREDDIT_ID,
    subredditName: TEST_SUBREDDIT_NAME,
};

export function isRefreshJob(job: Readonly<{ name: string }>): job is ScheduledJob {
    return "runAt" in job && job.name === REFRESH_JOB_NAME;
}

export async function listRefreshJobs(): Promise<ScheduledJob[]> {
    return (await scheduler.listJobs()).filter(isRefreshJob);
}

function isRefreshCheck(job: Readonly<{ name: string }>): job is ScheduledCronJob {
    return "cron" in job && job.name === REFRESH_CHECK_JOB_NAME;
}

/** The cron schedule of each hourly refresh check the scheduler holds. */
export async function listRefreshCheckCrons(): Promise<string[]> {
    return (await scheduler.listJobs())
        .filter(isRefreshCheck)
        .map(({ cron }: Readonly<{ cron: string }>): string => cron);
}

/** Submits a post through the harness as if at `isoTime`; the clock must already be faked. Returns the post ID. */
export async function submitPostAt(isoTime: string, title: string, text: string): Promise<string> {
    vi.setSystemTime(new Date(isoTime));
    const post = await reddit.submitPost({ subredditName: TEST_SUBREDDIT_NAME, title, text });
    return post.id;
}
