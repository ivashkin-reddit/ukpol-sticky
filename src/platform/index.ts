import type { RedisClient, Scheduler as DevvitScheduler } from "@devvit/public-api";

// The parts of Devvit's context that adapters use. Each adapter declares only the methods it calls; Devvit's real
// context satisfies these types, and tests supply exact typed fakes for them.

export type RedisPort<Method extends keyof RedisClient> = Readonly<Pick<RedisClient, Method>>;

export type SchedulerPort<Method extends keyof DevvitScheduler> = Readonly<Pick<DevvitScheduler, Method>>;

export type SubredditNamePort = Readonly<{
    reddit: Readonly<{ getCurrentSubredditName: () => Promise<string> }>;
    subredditName?: string | undefined;
}>;

export async function getSubredditName(context: SubredditNamePort): Promise<string> {
    return context.subredditName ?? (await context.reddit.getCurrentSubredditName());
}
