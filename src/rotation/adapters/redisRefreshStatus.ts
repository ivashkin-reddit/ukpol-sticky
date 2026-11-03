import type { RedisPort } from "../../platform/index.js";
import type { LastRefresh, RefreshStatus, RefreshStatusStore } from "../ports.js";

// Live state in every installed subreddit, so the key and its field names stay stable. A hash, so each write sets
// only its own fields and concurrent writers never overwrite each other's.
const REFRESH_STATUS = "RefreshStatus";

export type RefreshStatusRedis = RedisPort<"hDel" | "hGetAll" | "hSet">;

function parseDate(value: string | undefined): Date | undefined {
    if (value === undefined) {
        return undefined;
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
}

function parseLastRefresh(fields: Readonly<Record<string, string>>): LastRefresh | undefined {
    const at = parseDate(fields["lastRefreshAt"]);
    if (at === undefined) {
        return undefined;
    }

    const outcome = fields["lastRefreshOutcome"];
    if (outcome === "succeeded") {
        return { at, outcome };
    }

    return outcome === "failed" ? { at, outcome, failure: fields["lastRefreshFailure"] ?? "" } : undefined;
}

async function readStatus(redis: RefreshStatusRedis): Promise<RefreshStatus> {
    const fields = await redis.hGetAll(REFRESH_STATUS);
    return {
        lastRefresh: parseLastRefresh(fields),
        lastSuccessAt: parseDate(fields["lastSuccessAt"]),
        nextRefreshAt: parseDate(fields["nextRefreshAt"]),
    };
}

async function recordSuccess(redis: RefreshStatusRedis, at: Date): Promise<void> {
    await redis.hSet(REFRESH_STATUS, {
        lastRefreshAt: at.toISOString(),
        lastRefreshOutcome: "succeeded",
        lastSuccessAt: at.toISOString(),
    });
    await redis.hDel(REFRESH_STATUS, ["lastRefreshFailure"]);
}

async function recordNextRefresh(redis: RefreshStatusRedis, at: Date | undefined): Promise<void> {
    if (at === undefined) {
        await redis.hDel(REFRESH_STATUS, ["nextRefreshAt"]);
        return;
    }

    await redis.hSet(REFRESH_STATUS, { nextRefreshAt: at.toISOString() });
}

/** The refresh status as one Redis hash. */
export function redisRefreshStatus(redis: RefreshStatusRedis): RefreshStatusStore {
    return {
        read: async (): Promise<RefreshStatus> => await readStatus(redis),
        recordSuccess: async (at: Date): Promise<void> => {
            await recordSuccess(redis, at);
        },
        recordFailure: async (at: Date, failure: string): Promise<void> => {
            await redis.hSet(REFRESH_STATUS, {
                lastRefreshAt: at.toISOString(),
                lastRefreshOutcome: "failed",
                lastRefreshFailure: failure,
            });
        },
        recordNextRefresh: async (at: Date | undefined): Promise<void> => {
            await recordNextRefresh(redis, at);
        },
    };
}
