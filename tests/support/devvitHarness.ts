import { asT3ID } from "@devvit/public-api/types/tid.js";
import { reddit } from "@devvit/reddit";
import { redis } from "@devvit/redis";
import { scheduler } from "@devvit/scheduler";
import type { ScheduledJob } from "@devvit/scheduler";
import { vi } from "vitest";
import { REFRESH_STICKY_POSTS_JOB } from "../../src/constants.js";
import type { ManagedPost, StickyContext } from "../../src/stickyManager.js";

/** createDevvitTest()'s default subreddit. */
export const TEST_SUBREDDIT_ID = "t5_testsub";
export const TEST_SUBREDDIT_NAME = "testsub";

// The harness exposes Devvit Web's RedditClient, which offers getCurrentSubreddit() where the Blocks RedditAPIClient
// (what the app receives in production) offers getCurrentSubredditName(), and takes t3_-typed post IDs.
const harnessReddit: StickyContext["reddit"] = {
    modMail: reddit.modMail,
    getCurrentSubredditName: async (): Promise<string> => (await reddit.getCurrentSubreddit()).name,
    getPostById: async (id: string): Promise<ManagedPost> => await reddit.getPostById(asT3ID(id)),
    submitPost: async (options: Parameters<StickyContext["reddit"]["submitPost"]>[0]): Promise<ManagedPost> =>
        await reddit.submitPost(options),
};

/** The sticky manager's view of Devvit's in-memory test harness. */
export const HARNESS_CONTEXT: StickyContext = {
    reddit: harnessReddit,
    redis,
    scheduler,
    subredditId: TEST_SUBREDDIT_ID,
    subredditName: TEST_SUBREDDIT_NAME,
};

export function isRefreshJob(job: Readonly<{ name: string }>): job is ScheduledJob {
    return "runAt" in job && job.name === REFRESH_STICKY_POSTS_JOB;
}

export async function listRefreshJobs(): Promise<ScheduledJob[]> {
    return (await scheduler.listJobs()).filter(isRefreshJob);
}

/** Submits a post through the harness as if at `isoTime`; the clock must already be faked. Returns the post ID. */
export async function submitPostAt(isoTime: string, title: string, text: string): Promise<string> {
    vi.setSystemTime(new Date(isoTime));
    const post = await reddit.submitPost({ subredditName: TEST_SUBREDDIT_NAME, title, text });
    return post.id;
}
