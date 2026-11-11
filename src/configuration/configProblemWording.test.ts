import { describe, expect, it } from "vitest";
import type { ConfigPageProblem } from "./configPageCheck.js";
import { describeProblemForStatus } from "./configProblemWording.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(describeProblemForStatus, (): void => {
    it.for<readonly [ConfigPageProblem, string]>([
        [
            { kind: "invalidYaml", errors: ["Document 1: bad indentation  ", "Document 2: unexpected end"] },
            "The page contains invalid YAML: Document 1: bad indentation Document 2: unexpected end",
        ],
        [
            { kind: "invalidSchema", errors: "data/0 must have required property 'body'" },
            "The config is invalid: data/0 must have required property 'body'.",
        ],
        [
            { kind: "incompleteSchedule", configName: "daily" },
            "Config daily must define both frequency and postTime, or omit both to refresh only when maxComments is reached.",
        ],
        [
            { kind: "invalidDateFormat", configName: "daily", dateFormat: "yyyy-qqqqq", cause: new RangeError("bad") },
            "The date format `yyyy-qqqqq` in config daily is not a valid format string.",
        ],
        [{ kind: "duplicateNames" }, "Two configs share a name; every config name must be unique."],
        [
            { kind: "invalidValue", configName: "daily", reason: "its title is empty" },
            'Config "daily" is invalid: its title is empty.',
        ],
    ])(
        "words the %j problem for the status",
        TEST_OPTIONS,
        ([problem, text]: readonly [ConfigPageProblem, string]): void => {
            expect.assertions(1);

            expect(describeProblemForStatus(problem)).toBe(text);
        },
    );
});
