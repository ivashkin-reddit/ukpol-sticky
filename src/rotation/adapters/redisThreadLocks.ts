import { addMinutes } from "date-fns";
import type { RedisPort } from "../../platform/index.js";
import type { ThreadLocks } from "../ports.js";

// One key per thread config while it is being refreshed. Each expires on its own, so an invocation that dies holding
// a lock (Devvit ends it, say) blocks its thread for minutes, not for good. A refresh of one thread config takes
// seconds, far inside the expiry.
const LOCK_TTL_MINUTES = 2;

// A token's random part: Math.random() in base 36 (digits and lowercase letters), without its leading "0.".
const TOKEN_RADIX = 36;
const FRACTION_START = "0.".length;

/** The parts of a Redis transaction that releasing a lock uses; Devvit's transaction client satisfies it. */
export interface LockReleaseTransaction {
    readonly multi: () => Promise<void>;
    readonly del: (key: string) => Promise<unknown>;
    readonly exec: () => Promise<unknown>;
    readonly unwatch: () => Promise<unknown>;
}

export type ThreadLocksRedis = RedisPort<"get" | "set"> &
    Readonly<{ watch: (key: string) => Promise<LockReleaseTransaction> }>;

function getLockKey(configName: string): string {
    return `ThreadLock:${configName}`;
}

/** Unique to one claim: the time it was taken, then a random part for claims in the same millisecond. */
function createToken(now: Date): string {
    return `${now.toISOString()} ${Math.random().toString(TOKEN_RADIX).slice(FRACTION_START)}`;
}

/**
 * Deletes the lock only while it still holds `token`. A holder that outlived the expiry finds another invocation's
 * token, or none, and leaves it: deleting it would let a third invocation in alongside the second. The watch makes the
 * check and the delete one step; the transaction is discarded if the key changes in between.
 */
async function releaseIfHeld(redis: ThreadLocksRedis, configName: string, token: string): Promise<void> {
    const key = getLockKey(configName);
    const transaction = await redis.watch(key);
    if ((await redis.get(key)) !== token) {
        await transaction.unwatch();
        console.error(
            `The lock on thread config ${configName} expired before its refresh finished, so another refresh of it may have run at the same time.`,
        );
        return;
    }

    await transaction.multi();
    await transaction.del(key);
    await transaction.exec();
}

/**
 * Thread locks as expiring Redis keys, taken with an NX write so concurrent callers agree on one holder. Each lock
 * holds a token unique to the claim, and is released only by the invocation that claimed it.
 */
export function redisThreadLocks(redis: ThreadLocksRedis): ThreadLocks {
    // Built once per invocation by the composition root, so this holds the tokens of this invocation's locks.
    const heldTokens = new Map<string, string>();
    return {
        tryLock: async (configName: string): Promise<boolean> => {
            const now = new Date();
            const token = createToken(now);
            const claim = await redis.set(getLockKey(configName), token, {
                nx: true,
                expiration: addMinutes(now, LOCK_TTL_MINUTES),
            });
            // Redis answers a declined NX write with nil, which Devvit returns as "".
            if (claim !== "OK") {
                return false;
            }

            heldTokens.set(configName, token);
            return true;
        },
        unlock: async (configName: string): Promise<void> => {
            const token = heldTokens.get(configName);
            if (token === undefined) {
                return;
            }

            heldTokens.delete(configName);
            await releaseIfHeld(redis, configName, token);
        },
    };
}
