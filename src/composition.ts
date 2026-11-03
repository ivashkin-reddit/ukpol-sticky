import { redisConfigStore } from "./configuration/adapters/redisConfigStore.js";
import type { ConfigStoreRedis } from "./configuration/adapters/redisConfigStore.js";
import { wikiConfigPage } from "./configuration/adapters/wikiConfigPage.js";
import type { WikiConfigPageContext } from "./configuration/adapters/wikiConfigPage.js";
import { getThreadConfigs } from "./configuration/index.js";
import type { ConfigReadPorts, ConfigurationPorts, ThreadConfig } from "./configuration/index.js";
import { modmailNotifier } from "./notifications/adapters/modmail.js";
import type { ModmailContext } from "./notifications/adapters/modmail.js";
import { redditPosts } from "./rotation/adapters/redditPosts.js";
import type { RedditPostsContext } from "./rotation/adapters/redditPosts.js";
import { redisLivePosts } from "./rotation/adapters/redisLivePosts.js";
import type { LivePostsRedis } from "./rotation/adapters/redisLivePosts.js";
import { schedulerRefreshJobs } from "./rotation/adapters/schedulerRefreshJobs.js";
import type { RefreshScheduler } from "./rotation/adapters/schedulerRefreshJobs.js";
import type { RotationPorts } from "./rotation/index.js";

// The only code that builds adapters: each function turns the Devvit context a handler receives into the ports a
// module's use cases take. Devvit's trigger and job contexts satisfy these context types.

export type ConfigReadContext = ModmailContext & Readonly<{ redis: ConfigStoreRedis }>;

export type ConfigurationContext = ConfigReadContext & WikiConfigPageContext;

export type RotationContext = ConfigReadContext &
    RedditPostsContext &
    Readonly<{ redis: LivePostsRedis; scheduler: RefreshScheduler }>;

export function configReadPorts(context: ConfigReadContext): ConfigReadPorts {
    return { notifyModerators: modmailNotifier(context), store: redisConfigStore(context.redis) };
}

export function configurationPorts(context: ConfigurationContext): ConfigurationPorts {
    return { ...configReadPorts(context), page: wikiConfigPage(context) };
}

export function rotationPorts(context: RotationContext): RotationPorts {
    const configRead = configReadPorts(context);
    return {
        livePosts: redisLivePosts(context.redis),
        posts: redditPosts(context),
        refreshJobs: schedulerRefreshJobs(context.scheduler),
        threadConfigs: async (): Promise<readonly ThreadConfig[]> => await getThreadConfigs(configRead),
    };
}
