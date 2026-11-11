import { describe, expect, it } from "vitest";
import { findAttentionReasons, putFirst } from "./statusRules.js";
import type { AttentionState } from "./statusRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-04-21T10:00:00Z");

/** A healthy thread config: applied, with a live post and its next refresh pending this afternoon. */
const HEALTHY: AttentionState = {
    applied: true,
    hasLivePost: true,
    hasUnfinishedHandover: false,
    hasSchedule: true,
    pendingRunTimes: [new Date("2026-04-21T12:30:05Z")],
    lastRefreshFailed: false,
    postReadable: true,
};

describe(findAttentionReasons, (): void => {
    it("finds nothing for a healthy thread config", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findAttentionReasons(HEALTHY, NOW)).toStrictEqual([]);
    });

    it(
        "lists a failed last refresh, the refresh check's finding, then an unreadable post, in that order",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            expect(
                findAttentionReasons(
                    {
                        ...HEALTHY,
                        hasLivePost: false,
                        pendingRunTimes: [],
                        lastRefreshFailed: true,
                        postReadable: false,
                    },
                    NOW,
                ),
            ).toStrictEqual([
                { kind: "failed" },
                { kind: "check", finding: { kind: "no live post" } },
                { kind: "postUnreadable" },
            ]);
        },
    );

    it("reports a pending refresh long past its time as stuck", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const stuckAt = new Date("2026-04-21T09:00:05Z");

        expect(findAttentionReasons({ ...HEALTHY, pendingRunTimes: [stuckAt] }, NOW)).toStrictEqual([
            { kind: "check", finding: { kind: "stuck", stuckAt } },
        ]);
    });

    it("leaves alone an unapplied thread config whose retry is pending", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            findAttentionReasons(
                { ...HEALTHY, applied: false, pendingRunTimes: [new Date("2026-04-21T10:10:05Z")] },
                NOW,
            ),
        ).toStrictEqual([]);
    });
});

describe(putFirst, (): void => {
    it("puts the items it picks first, each part in its order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(putFirst(["a1", "b1", "a2", "b2"], (item: string): boolean => item.startsWith("a"))).toStrictEqual([
            "a1",
            "a2",
            "b1",
            "b2",
        ]);
    });
});
