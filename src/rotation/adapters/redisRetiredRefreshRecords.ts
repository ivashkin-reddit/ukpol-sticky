import type { RedisPort } from "../../platform/index.js";
import type { RetiredRefreshRecords } from "../ports.js";

// Keys from before refreshes were per thread config, in subreddits installed then. The upgrade reads the first and
// deletes both; nothing writes them any more.
const APPLIED_THREAD_CONFIGS = "AppliedThreadConfigs";
const REFRESH_STATUS = "RefreshStatus";

export type RetiredRefreshRecordsRedis = RedisPort<"del" | "get">;

/** The two Redis keys refreshes kept for all thread configs at once. */
export function redisRetiredRefreshRecords(redis: RetiredRefreshRecordsRedis): RetiredRefreshRecords {
    return {
        readAppliedThreadConfigs: async (): Promise<string | undefined> => await redis.get(APPLIED_THREAD_CONFIGS),
        delete: async (): Promise<void> => {
            await redis.del(APPLIED_THREAD_CONFIGS, REFRESH_STATUS);
        },
    };
}
