import { vi } from "vitest";
import type { Mock } from "vitest";
import type { Change, ChangeHistoryStore } from "../../src/changes/index.js";

export interface FakeChangeHistory {
    readonly store: ChangeHistoryStore;
    readonly add: Mock<ChangeHistoryStore["add"]>;
    readonly all: Mock<ChangeHistoryStore["all"]>;
}

/** A change history kept in memory: what is added is listed, as stored, after `stored`. */
export function createFakeChangeHistory(stored: readonly Change[] = []): FakeChangeHistory {
    const changes = [...stored];
    const add = vi.fn<ChangeHistoryStore["add"]>().mockImplementation(async (change: Change): Promise<void> => {
        changes.push(change);
        await Promise.resolve();
    });
    const all = vi
        .fn<ChangeHistoryStore["all"]>()
        .mockImplementation(async (): Promise<readonly Change[]> => await Promise.resolve([...changes]));
    return { store: { add, all }, add, all };
}
