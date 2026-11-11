import { describe, expect, it } from "vitest";
import { keptTitle, latestKept, oldestKept } from "./changeRules.js";
import type { Change } from "./changeRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-11-11T22:00:00Z");

function changeAt(at: Date): Change {
    return {
        kind: "pin",
        at,
        moderator: "mod_user",
        action: "pinned",
        post: { id: "t3_a", title: "A post" },
        fromSlot: undefined,
        toSlot: 2,
        label: "Event",
        unpinned: undefined,
    };
}

describe(latestKept, (): void => {
    it("returns the newest first, up to the count asked for", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const changes = [
            changeAt(new Date("2026-11-10T00:00:00Z")),
            changeAt(new Date("2026-11-11T00:00:00Z")),
            changeAt(new Date("2026-11-09T00:00:00Z")),
        ];

        expect(latestKept(changes, NOW, 2).map((change: Change): string => change.at.toISOString())).toStrictEqual([
            "2026-11-11T00:00:00.000Z",
            "2026-11-10T00:00:00.000Z",
        ]);
    });

    it("keeps a change from exactly 90 days ago and skips an older one", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const oldest = changeAt(new Date("2026-08-13T22:00:00Z"));

        expect(latestKept([changeAt(new Date("2026-08-13T21:59:59Z")), oldest], NOW, 5)).toStrictEqual([oldest]);
    });

    it("never returns more than 50", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const many = Array.from({ length: 60 }, (_unused: unknown, index: number): Change =>
            changeAt(new Date(NOW.getTime() - index * 1000)),
        );

        expect(latestKept(many, NOW, 100)).toHaveLength(50);
    });

    it("returns none from none", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(latestKept([], NOW, 5)).toStrictEqual([]);
    });
});

describe(oldestKept, (): void => {
    it("is 90 days before now", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(oldestKept(NOW).toISOString()).toBe("2026-08-13T22:00:00.000Z");
    });
});

describe(keptTitle, (): void => {
    it("keeps a title of up to 300 characters whole", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(keptTitle("x".repeat(300))).toBe("x".repeat(300));
    });

    it("cuts a longer title to 300 characters, ending in an ellipsis", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(keptTitle("x".repeat(301))).toBe(`${"x".repeat(299)}…`);
    });
});
