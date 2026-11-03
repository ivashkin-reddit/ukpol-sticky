import { addMinutes } from "date-fns";
import type { RedisPort } from "../../platform/index.js";
import type { AlertLatch } from "../index.js";

// An unconfirmed claim lapses this long after it is taken, so an alert whose sender died before sending it is sent by
// a later claimant. Sending a modmail takes seconds, far inside it.
const UNCONFIRMED_CLAIM_MINUTES = 10;

export type AlertLatchRedis = RedisPort<"del" | "set">;

/** An alert latch held as one Redis key, which records when it was claimed and then when the alert was sent. */
export function redisAlertLatch(redis: AlertLatchRedis, key: string): AlertLatch {
    return {
        claim: async (): Promise<boolean> => {
            const now = new Date();
            // The NX write lets concurrent claimants agree on one winner.
            const claim = await redis.set(key, now.toISOString(), {
                nx: true,
                expiration: addMinutes(now, UNCONFIRMED_CLAIM_MINUTES),
            });
            // Redis answers a declined NX write with nil, which Devvit returns as "".
            return claim === "OK";
        },
        confirm: async (): Promise<void> => {
            // A plain write drops the claim's expiry, so the claim stands until it is released.
            await redis.set(key, new Date().toISOString());
        },
        release: async (): Promise<void> => {
            await redis.del(key);
        },
    };
}
