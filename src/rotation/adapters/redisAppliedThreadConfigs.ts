import type { ThreadConfig } from "../../configuration/index.js";
import type { RedisPort } from "../../platform/index.js";
import type { AppliedThreadConfigs } from "../ports.js";

// Live state in every installed subreddit, so the key stays stable: a hash from each thread config's name to the
// version of it that its last refresh applied, as JSON. A thread config compares as that JSON, which is the same each
// time the same stored thread config is read.
const APPLIED_THREAD_CONFIGS = "AppliedThreadConfigsByName";

export type AppliedThreadConfigsRedis = RedisPort<"hDel" | "hGet" | "hKeys" | "hSet">;

/** The version of each thread config that its last refresh applied, as one Redis hash. */
export function redisAppliedThreadConfigs(redis: AppliedThreadConfigsRedis): AppliedThreadConfigs {
    return {
        matches: async (config: ThreadConfig): Promise<boolean> =>
            (await redis.hGet(APPLIED_THREAD_CONFIGS, config.name)) === JSON.stringify(config),
        record: async (config: ThreadConfig): Promise<void> => {
            await redis.hSet(APPLIED_THREAD_CONFIGS, { [config.name]: JSON.stringify(config) });
        },
        configNames: async (): Promise<readonly string[]> => await redis.hKeys(APPLIED_THREAD_CONFIGS),
        forget: async (configNames: readonly string[]): Promise<void> => {
            if (configNames.length > 0) {
                await redis.hDel(APPLIED_THREAD_CONFIGS, [...configNames]);
            }
        },
    };
}
