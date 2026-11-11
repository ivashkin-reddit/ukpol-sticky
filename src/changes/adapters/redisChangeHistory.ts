import type { RedisPort } from "../../platform/index.js";
import { KEPT_CHANGES, oldestKept } from "../domain/changeRules.js";
import type { Change, PinAction, PostRef } from "../domain/changeRules.js";
import type { ChangeHistoryStore } from "../ports.js";

// Live state in every installed subreddit, so the key stays stable: a sorted set of changes, each scored by its time
// in milliseconds and stored as JSON.
const CHANGE_HISTORY = "ChangeHistory";
const LOGGED_MEMBER_LENGTH = 200;
const PIN_ACTIONS: readonly PinAction[] = ["moved", "pinned", "relabelled", "unpinned"];

export type ChangeHistoryRedis = RedisPort<"zAdd" | "zRange" | "zRemRangeByRank" | "zRemRangeByScore">;

type JsonRecord = Readonly<Record<string, unknown>>;

function isRecord(value: unknown): value is JsonRecord {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOptionalNumber(value: unknown): value is number | undefined {
    return value === undefined || typeof value === "number";
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === "string";
}

function readPostRef(value: unknown): PostRef | undefined {
    if (!isRecord(value)) {
        return undefined;
    }

    const { id, title } = value;
    return typeof id === "string" && typeof title === "string" ? { id, title } : undefined;
}

function readAction(value: unknown): PinAction | undefined {
    return PIN_ACTIONS.find((action: PinAction): boolean => action === value);
}

function parseJson(member: string): unknown {
    try {
        return JSON.parse(member);
    } catch {
        return undefined;
    }
}

/** The post Reddit unpinned, as stored: absent for none; "invalid" when present but not a post. */
function readUnpinned(value: unknown): PostRef | "invalid" | undefined {
    return value === undefined ? undefined : (readPostRef(value) ?? "invalid");
}

/** The pin change a stored record holds, or undefined when it holds none. */
function readPinChange(record: JsonRecord): Change | undefined {
    const { at, moderator, fromSlot, toSlot, label } = record;
    const action = readAction(record["action"]);
    const post = readPostRef(record["post"]);
    const unpinned = readUnpinned(record["unpinned"]);
    if (
        typeof at !== "string" ||
        typeof moderator !== "string" ||
        action === undefined ||
        post === undefined ||
        unpinned === "invalid" ||
        !isOptionalNumber(fromSlot) ||
        !isOptionalNumber(toSlot) ||
        !isOptionalString(label)
    ) {
        return undefined;
    }

    return { kind: "pin", at: new Date(at), moderator, action, post, fromSlot, toSlot, label, unpinned };
}

/** The change a stored member holds, or undefined when it holds none. */
function parseChange(member: string): Change | undefined {
    const value = parseJson(member);
    return isRecord(value) && value["kind"] === "pin" ? readPinChange(value) : undefined;
}

function readMembers(members: readonly Readonly<{ member: string }>[]): Change[] {
    return members.flatMap(({ member }: Readonly<{ member: string }>): Change[] => {
        const change = parseChange(member);
        if (change === undefined) {
            console.warn(
                `Skipped a change history entry that cannot be read: ${member.slice(0, LOGGED_MEMBER_LENGTH)}`,
            );
            return [];
        }

        return [change];
    });
}

/** The change history as one Redis sorted set; each add trims it to the last 50 changes within 90 days. */
export function redisChangeHistory(redis: ChangeHistoryRedis): ChangeHistoryStore {
    return {
        add: async (change: Change): Promise<void> => {
            await redis.zAdd(CHANGE_HISTORY, {
                member: JSON.stringify({ ...change, at: change.at.toISOString() }),
                score: change.at.getTime(),
            });
            await redis.zRemRangeByScore(CHANGE_HISTORY, 0, oldestKept(change.at).getTime() - 1);
            await redis.zRemRangeByRank(CHANGE_HISTORY, 0, -(KEPT_CHANGES + 1));
        },
        all: async (): Promise<readonly Change[]> =>
            readMembers(await redis.zRange(CHANGE_HISTORY, 0, -1, { by: "rank" })),
    };
}
