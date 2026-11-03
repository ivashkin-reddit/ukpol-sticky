import type { RedisClient, Scheduler as DevvitScheduler } from "@devvit/public-api";

// Each handler declares only the parts of Devvit's context it uses. Devvit's real context satisfies these types,
// and tests supply exact typed fakes for them.

export type RedisPort<Method extends keyof RedisClient> = Readonly<Pick<RedisClient, Method>>;

export type SchedulerPort<Method extends keyof DevvitScheduler> = Readonly<Pick<DevvitScheduler, Method>>;

export type SubredditNamePort = Readonly<{
    reddit: Readonly<{ getCurrentSubredditName: () => Promise<string> }>;
    subredditName?: string | undefined;
}>;

export async function getSubredditName(context: SubredditNamePort): Promise<string> {
    return context.subredditName ?? (await context.reddit.getCurrentSubredditName());
}
