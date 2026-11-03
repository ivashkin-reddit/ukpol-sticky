import { describe, expect, it } from "vitest";
import type { Schedule, ThreadConfig } from "../configuration/index.js";
import { earliest, getRotationTime, isDueForRotation, refreshOrder } from "./rotationRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CAP_ONLY_CONFIG: ThreadConfig = {
    name: "cap-thread",
    enabled: true,
    title: "Cap",
    maxComments: 100,
    body: "Body",
};
const DAILY_CONFIG: ThreadConfig = { ...CAP_ONLY_CONFIG, name: "daily-thread", frequency: "daily", postTime: "12:00" };

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

describe(isDueForRotation, (): void => {
    const MORNING_POST = { createdAt: new Date("2026-04-21T05:00:00Z"), numberOfComments: 10 };

    it("is not due before its rotation time and below its comment cap", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, DAILY_CONFIG, Date.parse("2026-04-21T11:59:00Z"))).toBe(false);
    });

    it("is due once its rotation time has passed", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, DAILY_CONFIG, Date.parse("2026-04-21T12:01:00Z"))).toBe(true);
    });

    it("is due at its comment cap, whatever its schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const fullPost = { ...MORNING_POST, numberOfComments: 100 };

        expect(isDueForRotation(fullPost, CAP_ONLY_CONFIG, Date.parse("2026-04-21T06:00:00Z"))).toBe(true);
    });

    it("never comes due by time without a schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(isDueForRotation(MORNING_POST, CAP_ONLY_CONFIG, Date.parse("2030-01-01T00:00:00Z"))).toBe(false);
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
