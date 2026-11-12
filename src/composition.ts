import { redisChangeHistory } from "./changes/adapters/redisChangeHistory.js";
import type { ChangeHistoryRedis } from "./changes/adapters/redisChangeHistory.js";
import type { ChangeHistoryStore } from "./changes/index.js";
import { redisConfigStore } from "./configuration/adapters/redisConfigStore.js";
import type { ConfigStoreRedis } from "./configuration/adapters/redisConfigStore.js";
import { wikiConfigPage } from "./configuration/adapters/wikiConfigPage.js";
import type { WikiConfigPageContext } from "./configuration/adapters/wikiConfigPage.js";
import { getThreadConfigs } from "./configuration/index.js";
import type { ConfigReadPorts, ConfigurationPorts, ThreadConfig } from "./configuration/index.js";
import { redditHighlights } from "./highlights/adapters/redditHighlights.js";
import type { RedditHighlightsContext } from "./highlights/adapters/redditHighlights.js";
import type { ModeratorsContext } from "./moderators.js";
import { modmailNotifier } from "./notifications/adapters/modmail.js";
import type { ModmailContext } from "./notifications/adapters/modmail.js";
import { redisAlertLatch } from "./notifications/adapters/redisAlertLatch.js";
import type { AlertLatchRedis } from "./notifications/adapters/redisAlertLatch.js";
import type { AlertLatch } from "./notifications/index.js";
import { redditPosts } from "./rotation/adapters/redditPosts.js";
import type { RedditPostsContext } from "./rotation/adapters/redditPosts.js";
import { redisAppliedThreadConfigs } from "./rotation/adapters/redisAppliedThreadConfigs.js";
import type { AppliedThreadConfigsRedis } from "./rotation/adapters/redisAppliedThreadConfigs.js";
import { redisLivePosts } from "./rotation/adapters/redisLivePosts.js";
import type { LivePostsRedis } from "./rotation/adapters/redisLivePosts.js";
import { redisRefreshStatus } from "./rotation/adapters/redisRefreshStatus.js";
import type { RefreshStatusRedis } from "./rotation/adapters/redisRefreshStatus.js";
import { redisRetiredRefreshRecords } from "./rotation/adapters/redisRetiredRefreshRecords.js";
import type { RetiredRefreshRecordsRedis } from "./rotation/adapters/redisRetiredRefreshRecords.js";
import { redisThreadLocks } from "./rotation/adapters/redisThreadLocks.js";
import type { ThreadLocksRedis } from "./rotation/adapters/redisThreadLocks.js";
import { schedulerRefreshJobs } from "./rotation/adapters/schedulerRefreshJobs.js";
import type { RefreshScheduler } from "./rotation/adapters/schedulerRefreshJobs.js";
import type { RotationPorts } from "./rotation/index.js";

// The only code that builds adapters: each function turns the Devvit context a handler receives into the ports a
// module's use cases take. Devvit's trigger and job contexts satisfy these context types.

// Live state in every installed subreddit, so these keys stay stable: each holds the claim on one alert's latch.
const UNREADABLE_CONFIG_ALERT_KEY = "UnreadableConfigAlertSent";
const REFRESH_FAILURE_ALERT_KEY = "RefreshFailureAlertSent";
// One per thread config: the latch of the alert about its failed refreshes.
const THREAD_FAILURE_ALERT_KEY_PREFIX = "RefreshFailureAlertSent:";

export type ConfigReadContext = ModmailContext & Readonly<{ redis: AlertLatchRedis & ConfigStoreRedis }>;

export type ChangesContext = Readonly<{ redis: ChangeHistoryRedis }>;

export type ConfigurationContext = ConfigReadContext & WikiConfigPageContext;

export type RotationContext = ConfigReadContext &
    RedditHighlightsContext &
    RedditPostsContext &
    Readonly<{
        redis: AppliedThreadConfigsRedis &
            LivePostsRedis &
            RefreshStatusRedis &
            RetiredRefreshRecordsRedis &
            ThreadLocksRedis;
        scheduler: RefreshScheduler;
    }>;

/**
 * Everything a handler receives: Devvit's clients for the request's installation, its subreddit, the app's slug, and,
 * for a request from Reddit's UI, who made it.
 */
export type DevvitContext = ChangesContext &
    ConfigurationContext &
    ModeratorsContext &
    RotationContext &
    Readonly<{ appSlug: string }>;

export function changesPorts(context: ChangesContext): ChangeHistoryStore {
    return redisChangeHistory(context.redis);
}

export function configReadPorts(context: ConfigReadContext): ConfigReadPorts {
    return {
        notifyModerators: modmailNotifier(context),
        store: redisConfigStore(context.redis),
        unreadableAlert: redisAlertLatch(context.redis, UNREADABLE_CONFIG_ALERT_KEY),
    };
}

export function configurationPorts(context: ConfigurationContext): ConfigurationPorts {
    return { ...configReadPorts(context), page: wikiConfigPage(context) };
}

export function rotationPorts(context: RotationContext): RotationPorts {
    const configRead = configReadPorts(context);
    return {
        appliedThreadConfigs: redisAppliedThreadConfigs(context.redis),
        highlights: redditHighlights(context),
        livePosts: redisLivePosts(context.redis),
        notifyModerators: configRead.notifyModerators,
        posts: redditPosts(context),
        refreshFailureAlert: redisAlertLatch(context.redis, REFRESH_FAILURE_ALERT_KEY),
        refreshJobs: schedulerRefreshJobs(context.scheduler),
        refreshStatus: redisRefreshStatus(context.redis),
        retiredRefreshRecords: redisRetiredRefreshRecords(context.redis),
        threadConfigs: async (): Promise<readonly ThreadConfig[]> => await getThreadConfigs(configRead),
        threadFailureAlert: (configName: string): AlertLatch =>
            redisAlertLatch(context.redis, `${THREAD_FAILURE_ALERT_KEY_PREFIX}${configName}`),
        threadLocks: redisThreadLocks(context.redis),
    };
}
