import { describe, expect, it } from "vitest";
import type { Schedule, ThreadConfig } from "../../configuration/index.js";
import {
    earliest,
    getRotationTime,
    isClearlyBelowCommentCap,
    isDueForRotation,
    refreshOrder,
} from "./rotationRules.js";
import type { RotationTriggers } from "./rotationRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CAP_ONLY_CONFIG: ThreadConfig = {
    name: "cap-thread",
    enabled: true,
    title: "Cap",
    maxComments: 100,
    body: "Body",
};
const DAILY_AT_NOON: RotationTriggers = { schedule: { kind: "daily", hours: 12, minutes: 0 }, commentCap: 100 };
const CAP_ONLY: RotationTriggers = { schedule: undefined, commentCap: 100 };

interface RotationCase {
    readonly schedule: Schedule;
    readonly postedAt: string;
    readonly rotatesAt: string;
}

const ROTATION_CASES: readonly RotationCase[] = [
    {
        schedule: { kind: "daily", hours: 14, minutes: 0 },
        postedAt: "2023-02-02T02:00:00Z",
        rotatesAt: "2023-02-02T14:00:00.000Z",
    },
    {
        schedule: { kind: "daily", hours: 14, minutes: 30 },
        postedAt: "2023-02-02T02:00:00Z",
        rotatesAt: "2023-02-02T14:30:00.000Z",
    },
    {
        schedule: { kind: "daily", hours: 12, minutes: 30 },
        postedAt: "2026-04-21T05:00:00Z",
        rotatesAt: "2026-04-21T12:30:00.000Z",
    },
    // Posted less than six hours before its next post time, across UTC midnight, so it runs until the one after.
    {
        schedule: { kind: "daily", hours: 0, minutes: 0 },
        postedAt: "2023-02-01T23:59:00Z",
        rotatesAt: "2023-02-03T00:00:00.000Z",
    },
    {
        schedule: { kind: "daily", hours: 2, minutes: 0 },
        postedAt: "2023-02-01T23:00:00Z",
        rotatesAt: "2023-02-03T02:00:00.000Z",
    },
    // Posted the evening before, more than six hours ahead of the next post time.
    {
        schedule: { kind: "daily", hours: 6, minutes: 0 },
        postedAt: "2023-02-01T20:00:00Z",
        rotatesAt: "2023-02-02T06:00:00.000Z",
    },
    // Posted less than six hours before today's post time, so it runs until tomorrow's.
    {
        schedule: { kind: "daily", hours: 14, minutes: 0 },
        postedAt: "2023-02-01T13:00:00Z",
        rotatesAt: "2023-02-02T14:00:00.000Z",
    },
    {
        schedule: { kind: "weekly", weekday: 3, hours: 1, minutes: 0 },
        postedAt: "2025-02-06T12:00:00Z",
        rotatesAt: "2025-02-12T01:00:00.000Z",
    },
    {
        schedule: { kind: "weekly", weekday: 3, hours: 1, minutes: 30 },
        postedAt: "2025-02-06T12:00:00Z",
        rotatesAt: "2025-02-12T01:30:00.000Z",
    },
    // Posted on its own weekday, so it runs until the same weekday next week.
    {
        schedule: { kind: "weekly", weekday: 3, hours: 1, minutes: 0 },
        postedAt: "2025-02-12T00:30:00Z",
        rotatesAt: "2025-02-19T01:00:00.000Z",
    },
];

describe(getRotationTime, (): void => {
    it.for(ROTATION_CASES)(
        "rotates a $schedule.kind post made at $postedAt at $rotatesAt",
        TEST_OPTIONS,
        (rotationCase: RotationCase): void => {
            expect.assertions(1);

            expect(getRotationTime(new Date(rotationCase.postedAt), rotationCase.schedule).toISOString()).toBe(
                rotationCase.rotatesAt,
            );
        },
    );
});

describe("getRotationTime for daily schedules", (): void => {
    it(
        "always rotates at the post time, at least six hours and less than thirty hours after creation",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            const violations: string[] = [];
            const startOfSweep = Date.parse("2026-03-28T00:00:00Z");
            // Every quarter-hour post time, against creation times 47 minutes apart across three days.
            for (let quarter = 0; quarter < 96; quarter += 1) {
                const schedule: Schedule = {
                    kind: "daily",
                    hours: Math.floor(quarter / 4),
                    minutes: (quarter % 4) * 15,
                };
                for (let created = startOfSweep; created < startOfSweep + 3 * 86_400_000; created += 47 * 60_000) {
                    const rotation = getRotationTime(new Date(created), schedule);
                    const hoursLater = (rotation.getTime() - created) / 3_600_000;
                    const atPostTime =
                        rotation.getUTCHours() === schedule.hours && rotation.getUTCMinutes() === schedule.minutes;
                    if (!atPostTime || hoursLater < 6 || hoursLater >= 30) {
                        violations.push(`${new Date(created).toISOString()} -> ${rotation.toISOString()}`);
                    }
                }
            }

            expect(violations).toStrictEqual([]);
        },
    );
});

describe(isDueForRotation, (): void => {
    const MORNING_POST = { createdAt: new Date("2026-04-21T05:00:00Z"), numberOfComments: 10 };

    it("is not due before its rotation time and below its comment cap", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, DAILY_AT_NOON, Date.parse("2026-04-21T11:59:00Z"))).toBe(false);
    });

    it("is due once its rotation time has passed", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, DAILY_AT_NOON, Date.parse("2026-04-21T12:01:00Z"))).toBe(true);
    });

    it("is due at its comment cap, whatever its schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const fullPost = { ...MORNING_POST, numberOfComments: 100 };

        expect(isDueForRotation(fullPost, CAP_ONLY, Date.parse("2026-04-21T06:00:00Z"))).toBe(true);
    });

    it("never comes due by time without a schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, CAP_ONLY, Date.parse("2030-01-01T00:00:00Z"))).toBe(false);
    });
});

describe(refreshOrder, (): void => {
    it("keeps enabled thread configs only, sticky first, otherwise in page order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const first = { ...CAP_ONLY_CONFIG, name: "first" };
        const disabled = { ...CAP_ONLY_CONFIG, name: "disabled", enabled: false, sticky: true };
        const sticky = { ...CAP_ONLY_CONFIG, name: "sticky", sticky: true };
        const last = { ...CAP_ONLY_CONFIG, name: "last", sticky: null };

        expect(refreshOrder([first, disabled, sticky, last]).map((config): string => config.name)).toStrictEqual([
            "sticky",
            "first",
            "last",
        ]);
    });
});

describe(earliest, (): void => {
    it("returns the earliest instant, ignoring missing ones", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const noon = new Date("2026-04-21T12:00:00Z");

        expect(earliest([undefined, new Date("2026-04-22T00:00:00Z"), noon, undefined])).toBe(noon);
    });

    it("returns undefined when there is no instant", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(earliest([undefined])).toBeUndefined();
    });
});

interface CapExample {
    readonly reported: number;
    readonly cap: number;
    readonly below: boolean;
    readonly why: string;
}

describe(isClearlyBelowCommentCap, (): void => {
    it.for<CapExample>([
        { reported: 50, cap: 100, below: true, why: "far below" },
        { reported: 98, cap: 100, below: true, why: "below even counting this comment" },
        { reported: 99, cap: 100, below: false, why: "at the cap if the count leaves out this comment" },
        { reported: 100, cap: 100, below: false, why: "at the cap" },
        { reported: 150, cap: 100, below: false, why: "past the cap" },
        { reported: 0, cap: 100, below: false, why: "not reported: a post with a new comment has at least one" },
    ])(
        "is $below for $reported reported comments under a cap of $cap ($why)",
        TEST_OPTIONS,
        (example: CapExample): void => {
            expect.assertions(1);

            expect(isClearlyBelowCommentCap(example.reported, example.cap)).toBe(example.below);
        },
    );
});
