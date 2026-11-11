import type { RedisPort } from "../../platform/index.js";
import type { NextRefreshReason } from "../domain/refreshRules.js";
import type { LastRefresh, RefreshStatus, RefreshStatusStore, ScheduledRefresh } from "../ports.js";

// Live state in every installed subreddit, so the key prefix and field names stay stable: one hash per thread config.
// A hash, so each write sets only its own fields and concurrent writers never overwrite each other's.
const REFRESH_STATUS_PREFIX = "RefreshStatus:";

export type RefreshStatusRedis = RedisPort<"del" | "hDel" | "hGetAll" | "hSet">;

function getStatusKey(configName: string): string {
    return `${REFRESH_STATUS_PREFIX}${configName}`;
}

/** A next refresh's reason as stored: a short code that stays stable whatever the reason's wording. */
function encodeReason(reason: NextRefreshReason): string {
    switch (reason) {
        case "to apply its stored thread config":
            return "apply";
        case "to retry it after a failure":
            return "retry";
        case "to publish its live post":
            return "publish";
        case "to finish its handover":
            return "handover";
        case "to rotate it":
            return "rotate";
        case "requested":
            return "requested";
    }
}

/** The reason a stored code names; undefined for none, or for a code this version does not know. */
function decodeReason(code: string | undefined): NextRefreshReason | undefined {
    switch (code) {
        case "apply":
            return "to apply its stored thread config";
        case "retry":
            return "to retry it after a failure";
        case "publish":
            return "to publish its live post";
        case "handover":
            return "to finish its handover";
        case "rotate":
            return "to rotate it";
        case "requested":
            return "requested";
        case undefined:
        default:
            return undefined;
    }
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
        nextRefreshReason: decodeReason(fields["nextRefreshReason"]),
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

async function recordNextRefresh(
    redis: RefreshStatusRedis,
    configName: string,
    next: ScheduledRefresh | undefined,
): Promise<void> {
    const key = getStatusKey(configName);
    if (next === undefined) {
        await redis.hDel(key, ["nextRefreshAt", "nextRefreshReason"]);
        return;
    }

    await redis.hSet(key, { nextRefreshAt: next.at.toISOString(), nextRefreshReason: encodeReason(next.reason) });
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
        recordNextRefresh: async (configName: string, next: ScheduledRefresh | undefined): Promise<void> => {
            await recordNextRefresh(redis, configName, next);
        },
        forget: async (configNames: readonly string[]): Promise<void> => {
            if (configNames.length > 0) {
                await redis.del(...configNames.map(getStatusKey));
            }
        },
    };
}
