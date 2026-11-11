import { latestKept } from "./domain/changeRules.js";
import type { Change } from "./domain/changeRules.js";
import type { ChangeHistoryStore } from "./ports.js";

/** The latest `count` changes still kept as of `now`, newest first. */
export async function readLatestChanges(
    count: number,
    now: Date,
    store: Pick<ChangeHistoryStore, "all">,
): Promise<readonly Change[]> {
    return latestKept(await store.all(), now, count);
}
