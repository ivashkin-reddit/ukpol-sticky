import type { RedisPort } from "../../platform/index.js";
import type { LastRefresh, RefreshStatus, RefreshStatusStore } from "../ports.js";

// Live state in every installed subreddit, so the key prefix and field names stay stable: one hash per thread config.
// A hash, so each write sets only its own fields and concurrent writers never overwrite each other's.
const REFRESH_STATUS_PREFIX = "RefreshStatus:";

export type RefreshStatusRedis = RedisPort<"del" | "hDel" | "hGetAll" | "hSet">;

function getStatusKey(configName: string): string {
    return `${REFRESH_STATUS_PREFIX}${configName}`;
}

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

async function readStatus(redis: RefreshStatusRedis, configName: string): Promise<RefreshStatus> {
    const fields = await redis.hGetAll(getStatusKey(configName));
    return {
        lastRefresh: parseLastRefresh(fields),
        lastSuccessAt: parseDate(fields["lastSuccessAt"]),
        nextRefreshAt: parseDate(fields["nextRefreshAt"]),
    };
}

async function readStatuses(
    redis: RefreshStatusRedis,
    configNames: readonly string[],
): Promise<Readonly<Record<string, RefreshStatus>>> {
    const statuses = await Promise.all(
        configNames.map(async (configName: string): Promise<readonly [string, RefreshStatus]> => [
            configName,
            await readStatus(redis, configName),
        ]),
    );
    return Object.fromEntries(statuses);
}

async function recordSuccess(redis: RefreshStatusRedis, configName: string, at: Date): Promise<void> {
    const key = getStatusKey(configName);
    await redis.hSet(key, {
        lastRefreshAt: at.toISOString(),
        lastRefreshOutcome: "succeeded",
        lastSuccessAt: at.toISOString(),
    });
    await redis.hDel(key, ["lastRefreshFailure"]);
}

async function recordNextRefresh(redis: RefreshStatusRedis, configName: string, at: Date | undefined): Promise<void> {
    const key = getStatusKey(configName);
    if (at === undefined) {
        await redis.hDel(key, ["nextRefreshAt"]);
        return;
    }

    await redis.hSet(key, { nextRefreshAt: at.toISOString() });
}

/** Each thread config's refresh status, as one Redis hash per thread config. */
export function redisRefreshStatus(redis: RefreshStatusRedis): RefreshStatusStore {
    return {
        read: async (configNames: readonly string[]): Promise<Readonly<Record<string, RefreshStatus>>> =>
            await readStatuses(redis, configNames),
        recordSuccess: async (configName: string, at: Date): Promise<void> => {
            await recordSuccess(redis, configName, at);
        },
        recordFailure: async (configName: string, at: Date, failure: string): Promise<void> => {
            await redis.hSet(getStatusKey(configName), {
                lastRefreshAt: at.toISOString(),
                lastRefreshOutcome: "failed",
                lastRefreshFailure: failure,
            });
        },
        recordNextRefresh: async (configName: string, at: Date | undefined): Promise<void> => {
            await recordNextRefresh(redis, configName, at);
        },
        forget: async (configNames: readonly string[]): Promise<void> => {
            if (configNames.length > 0) {
                await redis.del(...configNames.map(getStatusKey));
            }
        },
    };
}
