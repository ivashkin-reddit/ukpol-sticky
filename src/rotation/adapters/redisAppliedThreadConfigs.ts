import type { ThreadConfig } from "../../configuration/index.js";
import type { RedisPort } from "../../platform/index.js";
import type { AppliedThreadConfigs } from "../ports.js";

// Live state in every installed subreddit, so the key stays stable: the thread configs the last refresh applied, as
// JSON. Thread configs compare as that JSON, which is the same each time the same stored thread configs are read.
const APPLIED_THREAD_CONFIGS = "AppliedThreadConfigs";

export type AppliedThreadConfigsRedis = RedisPort<"get" | "set">;

/** The thread configs the last refresh applied, as one Redis key. */
export function redisAppliedThreadConfigs(redis: AppliedThreadConfigsRedis): AppliedThreadConfigs {
    return {
        matches: async (configs: readonly ThreadConfig[]): Promise<boolean> =>
            (await redis.get(APPLIED_THREAD_CONFIGS)) === JSON.stringify(configs),
        record: async (configs: readonly ThreadConfig[]): Promise<void> => {
            await redis.set(APPLIED_THREAD_CONFIGS, JSON.stringify(configs));
        },
    };
}
