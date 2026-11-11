import json2md from "json2md";
import { describe, expect, it } from "vitest";
import type { ConfigPageProblem } from "./configPageCheck.js";
import { describeProblem, describeProblemForStatus, summarizeProblem } from "./configProblemWording.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const SHARED_SLOT: ConfigPageProblem = { kind: "sharedSlot", slot: 1, configNames: ["weekly", "daily"] };
const TOO_MANY_PINNED: ConfigPageProblem = { kind: "tooManyPinned", count: 7 };

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
        [SHARED_SLOT, "Configs weekly and daily both ask for slot 1; each pinned config needs its own slot."],
        [TOO_MANY_PINNED, "7 enabled configs are pinned, but Reddit holds at most 6 highlights."],
    ])(
        "words the %j problem for the status",
        TEST_OPTIONS,
        ([problem, text]: readonly [ConfigPageProblem, string]): void => {
            expect.assertions(1);

            expect(describeProblemForStatus(problem)).toBe(text);
        },
    );
});

describe(describeProblem, (): void => {
    it("tells moderators which two configs share a slot", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeProblem(SHARED_SLOT, "/u/mod")).toStrictEqual({
            subject: "Two configs share slot 1",
            bodyMarkdown: json2md([
                {
                    p: "/u/mod, configs weekly and daily both ask for slot 1 in wiki page stickymgr/config. Give each pinned config its own slot.",
                },
                { p: "The existing config will be used until the issue is resolved." },
            ]),
        });
    });

    it("tells moderators how many configs are pinned past Reddit's six", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeProblem(TOO_MANY_PINNED, "/u/mod")).toStrictEqual({
            subject: "Too many pinned configs in wiki page stickymgr/config",
            bodyMarkdown: json2md([
                {
                    p: "/u/mod, 7 enabled configs in wiki page stickymgr/config are pinned (with slot or sticky: true), but Reddit holds at most 6 highlights. Unpin some, then save the page again.",
                },
                { p: "The existing config will be used until the issue is resolved." },
            ]),
        });
    });
});

describe(summarizeProblem, (): void => {
    it.for<readonly [ConfigPageProblem, string]>([
        [SHARED_SLOT, "thread configs weekly and daily share slot 1"],
        [TOO_MANY_PINNED, "7 enabled thread configs are pinned; at most 6 can be"],
    ])(
        "words the %j problem for the log",
        TEST_OPTIONS,
        ([problem, text]: readonly [ConfigPageProblem, string]): void => {
            expect.assertions(1);

            expect(summarizeProblem(problem)).toBe(text);
        },
    );
});
