import type { RedisClient, SchedulerClient } from "@devvit/web/server";

// The parts of Devvit Web's clients and request context that adapters use. Each adapter declares only what it calls;
// Devvit's clients satisfy these types, and tests supply exact typed fakes for them.

export type RedisPort<Method extends keyof RedisClient> = Readonly<Pick<RedisClient, Method>>;

export type SchedulerPort<Method extends keyof SchedulerClient> = Readonly<Pick<SchedulerClient, Method>>;

/** The subreddit the request is for, as Devvit Web's request context names it. */
export type SubredditNamePort = Readonly<{ subredditName: string }>;
