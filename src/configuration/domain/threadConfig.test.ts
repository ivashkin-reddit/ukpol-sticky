import { describe, expect, it } from "vitest";
import { checkThreadConfigs, checkThreadConfigSchema, getSchedule } from "./threadConfig.js";
import type { Schedule, ThreadConfig } from "./threadConfig.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

describe(checkThreadConfigSchema, (): void => {
    it.for(["postTime", "sticky", "endNote", "lockOnRefresh"])(
        "accepts null for the optional key %s",
        TEST_OPTIONS,
        (key: string): void => {
            expect.assertions(1);

            const config = { ...MINIMAL_CONFIG, [key]: null };

            expect(checkThreadConfigSchema([config])).toStrictEqual({ kind: "valid", configs: [config] });
        },
    );

    it("rejects null for frequency, which is not one of its allowed values", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigSchema([{ ...MINIMAL_CONFIG, frequency: null }])).toStrictEqual({
            kind: "invalid",
            errors: "data/0/frequency must be equal to one of the allowed values",
        });
    });

    it("rejects a comment cap below 1", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigSchema([{ ...MINIMAL_CONFIG, maxComments: 0 }])).toStrictEqual({
            kind: "invalid",
            errors: "data/0/maxComments must be >= 1",
        });
    });
});

describe(checkThreadConfigs, (): void => {
    it("accepts valid thread configs unchanged", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigs([MINIMAL_CONFIG])).toStrictEqual({ kind: "valid", configs: [MINIMAL_CONFIG] });
    });

    it("reports the first problem in config page order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const incomplete: ThreadConfig = { ...MINIMAL_CONFIG, name: "incomplete", frequency: "daily" };
        const badDate: ThreadConfig = { ...MINIMAL_CONFIG, name: "bad-date", title: "Daily {{date nope}}" };

        expect(checkThreadConfigs([incomplete, badDate])).toStrictEqual({
            kind: "invalid",
            problem: { kind: "incompleteSchedule", configName: "incomplete" },
        });
    });

    it("reports duplicate names only once each thread config is sound", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigs([MINIMAL_CONFIG, MINIMAL_CONFIG])).toStrictEqual({
            kind: "invalid",
            problem: { kind: "duplicateNames" },
        });
    });
});

describe(getSchedule, (): void => {
    it("returns undefined for a thread config that rotates only at its comment cap", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(getSchedule(MINIMAL_CONFIG)).toBeUndefined();
    });

    it("returns undefined when postTime was left empty", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(getSchedule({ ...MINIMAL_CONFIG, frequency: "daily", postTime: null })).toBeUndefined();
    });

    it.for<readonly [NonNullable<ThreadConfig["frequency"]>, string, Schedule]>([
        ["daily", "23:05", { kind: "daily", hours: 23, minutes: 5 }],
        ["sundays", "00:00", { kind: "weekly", weekday: 0, hours: 0, minutes: 0 }],
        ["wednesdays", "01:30", { kind: "weekly", weekday: 3, hours: 1, minutes: 30 }],
        ["saturdays", "12:00", { kind: "weekly", weekday: 6, hours: 12, minutes: 0 }],
    ])(
        "parses %s at %s",
        TEST_OPTIONS,
        ([frequency, postTime, schedule]: readonly [
            NonNullable<ThreadConfig["frequency"]>,
            string,
            Schedule,
        ]): void => {
            expect.assertions(1);

            expect(getSchedule({ ...MINIMAL_CONFIG, frequency, postTime })).toStrictEqual(schedule);
        },
    );

    it.for(["7:05", "24:00", "12:60", "12:30 "])("rejects the postTime %j", TEST_OPTIONS, (postTime: string): void => {
        expect.assertions(1);

        expect((): void => {
            getSchedule({ ...MINIMAL_CONFIG, frequency: "daily", postTime });
        }).toThrow(new RangeError(`postTime "${postTime}" is not in HH:mm format.`));
    });
});
