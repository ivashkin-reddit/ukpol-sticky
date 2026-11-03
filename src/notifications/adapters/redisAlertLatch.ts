import type { RedisPort } from "../../platform/index.js";
import type { AlertLatch } from "../index.js";

export type AlertLatchRedis = RedisPort<"del" | "set">;

/** An alert latch held as one Redis key, which records when it was claimed. */
export function redisAlertLatch(redis: AlertLatchRedis, key: string): AlertLatch {
    return {
        claim: async (): Promise<boolean> => {
            // The NX write lets concurrent claimants agree on one winner.
            const claim = await redis.set(key, new Date().toISOString(), { nx: true });
            // Redis answers a declined NX write with nil, which Devvit returns as "".
            return claim === "OK";
        },
        release: async (): Promise<void> => {
            await redis.del(key);
        },
    };
}
