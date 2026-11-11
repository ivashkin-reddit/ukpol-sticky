import { describe, expect, it } from "vitest";
import { createFakeChangeHistory } from "../../tests/support/fakeChangeHistory.js";
import { readLatestChanges } from "./changeHistory.js";
import type { Change } from "./domain/changeRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-11-11T22:00:00Z");

function changeAt(iso: string): Change {
    return {
        kind: "pin",
        at: new Date(iso),
        moderator: "mod_user",
        action: "unpinned",
        post: { id: "t3_a", title: "A post" },
        fromSlot: 1,
        toSlot: undefined,
        label: undefined,
        unpinned: undefined,
    };
}

describe(readLatestChanges, (): void => {
    it(
        "reads the stored changes once and returns the latest kept, newest first",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const recent = changeAt("2026-11-11T21:00:00Z");
            const older = changeAt("2026-11-10T21:00:00Z");
            const history = createFakeChangeHistory([older, changeAt("2026-01-01T00:00:00Z"), recent]);

            await expect(readLatestChanges(5, NOW, history.store)).resolves.toStrictEqual([recent, older]);
            expect(history.all).toHaveBeenCalledExactlyOnceWith();
        },
    );
});
