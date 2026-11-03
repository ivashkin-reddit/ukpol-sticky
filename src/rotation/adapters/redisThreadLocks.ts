import { addMinutes } from "date-fns";
import type { RedisPort } from "../../platform/index.js";
import type { ThreadLocks } from "../ports.js";

// One key per thread config while it is being refreshed. Each expires on its own, so an invocation that dies holding
// a lock (Devvit ends it, say) blocks its thread for minutes, not for good. A refresh of one thread config takes
// seconds, far inside the expiry.
const LOCK_TTL_MINUTES = 2;

export type ThreadLocksRedis = RedisPort<"del" | "set">;

function getLockKey(configName: string): string {
    return `ThreadLock:${configName}`;
}

/** Thread locks as expiring Redis keys, taken with an NX write so concurrent callers agree on one holder. */
export function redisThreadLocks(redis: ThreadLocksRedis): ThreadLocks {
    return {
        tryLock: async (configName: string): Promise<boolean> => {
            const now = new Date();
            const claim = await redis.set(getLockKey(configName), now.toISOString(), {
                nx: true,
                expiration: addMinutes(now, LOCK_TTL_MINUTES),
            });
            // Redis answers a declined NX write with nil, which Devvit returns as "".
            return claim === "OK";
        },
        unlock: async (configName: string): Promise<void> => {
            await redis.del(getLockKey(configName));
        },
    };
}
