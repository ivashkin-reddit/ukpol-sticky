import { describe, expect, it } from "vitest";
import { createFakeConfigurationPorts } from "../../tests/support/fakeConfigurationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { applyConfigPageRevision } from "./configPageRevision.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

interface ProblemCase {
    readonly problem: string;
    readonly pageContent: string;
    readonly subject: string;
    readonly bodyMarkdown: string;
    readonly warnLog: string;
}

const PROBLEM_CASES: readonly ProblemCase[] = [
    {
        problem: "invalid YAML",
        pageContent: ["name: broken-thread", "enabled: true", "title: Broken thread", 'body: "unterminated'].join("\n"),
        subject: "Invalid YAML in wiki page stickymgr/config",
        bodyMarkdown:
            '\n/u/mod_user, the wiki page stickymgr/config contains invalid YAML. Please fix it.\n\n\nErrors:\n\n> Document 1: Missing closing "quote at line 4, column 20:\n> \n> body: "unterminated\n>                    ^\n> \n\n\nThe existing config will be used until the issue is resolved.\n',
        warnLog:
            'Rejected config page revision rev-2: invalid YAML: Document 1: Missing closing "quote at line 4, column 20:\n\nbody: "unterminated\n                   ^.',
    },
    {
        problem: "a schema violation",
        pageContent: [
            "name: invalid-thread",
            "enabled: true",
            "title: Invalid thread",
            "maxComments: 0",
            "body: bad",
        ].join("\n"),
        subject: "Invalid config in wiki page stickymgr/config",
        bodyMarkdown:
            "\n/u/mod_user, the config in wiki page stickymgr/config is invalid. Please fix it.\n\n\nErrors:\n\n> data/0/maxComments must be >= 1\n\n\nThe existing config will be used until the issue is resolved.\n",
        warnLog: "Rejected config page revision rev-2: invalid config: data/0/maxComments must be >= 1.",
    },
    {
        problem: "an empty frequency",
        pageContent: [
            "name: empty-thread",
            "enabled: true",
            "title: Empty",
            "frequency:",
            "maxComments: 5",
            "body: b",
        ].join("\n"),
        subject: "Invalid config in wiki page stickymgr/config",
        bodyMarkdown:
            "\n/u/mod_user, the config in wiki page stickymgr/config is invalid. Please fix it.\n\n\nErrors:\n\n> data/0/frequency must be equal to one of the allowed values\n\n\nThe existing config will be used until the issue is resolved.\n",
        warnLog:
            "Rejected config page revision rev-2: invalid config: data/0/frequency must be equal to one of the allowed values.",
    },
    {
        problem: "a frequency without a postTime",
        pageContent: [
            "name: incomplete-thread",
            "enabled: true",
            "title: Incomplete",
            "frequency: daily",
            "maxComments: 200",
            "body: hello",
        ].join("\n"),
        subject: "Incomplete schedule in config incomplete-thread",
        bodyMarkdown:
            "\n/u/mod_user, config incomplete-thread must define both frequency and postTime, or omit both to refresh only when maxComments is reached.\n",
        warnLog:
            "Rejected config page revision rev-2: thread config incomplete-thread sets only one of frequency and postTime.",
    },
    {
        problem: "an invalid date format",
        pageContent: [
            "name: dated-thread",
            "enabled: true",
            "title: Daily {{date nope}}",
            "maxComments: 200",
            "body: hello",
        ].join("\n"),
        subject: "Invalid date format in config dated-thread",
        bodyMarkdown:
            "\n/u/mod_user, the date format in config dated-thread is invalid. Please fix it.\n\n\nThe date format `nope` is not a valid format string.\n",
        warnLog:
            "Rejected config page revision rev-2: thread config dated-thread has an invalid date format (nope): Format string contains an unescaped latin alphabet character `n`.",
    },
    {
        problem: "duplicate config names",
        pageContent: [
            "name: twin",
            "enabled: true",
            "title: One",
            "maxComments: 1",
            "body: a",
            "---",
            "name: twin",
            "enabled: true",
            "title: Two",
            "maxComments: 2",
            "body: b",
        ].join("\n"),
        subject: "Duplicate config names in wiki page stickymgr/config",
        bodyMarkdown:
            "\n/u/mod_user, there are duplicate config names in wiki page stickymgr/config. Please ensure all config names are unique.\n",
        warnLog: "Rejected config page revision rev-2: two thread configs share a name.",
    },
    {
        problem: "a title longer than Reddit allows",
        pageContent: [
            "name: long-title",
            "enabled: true",
            `title: ${"t".repeat(301)}`,
            "maxComments: 5",
            "body: b",
        ].join("\n"),
        subject: "Invalid config in wiki page stickymgr/config",
        bodyMarkdown:
            '\n/u/mod_user, config "long-title" is invalid: its title is longer than Reddit\'s limit of 300 characters. Please fix it.\n\n\nThe existing config will be used until the issue is resolved.\n',
        warnLog:
            'Rejected config page revision rev-2: thread config "long-title" is invalid: its title is longer than Reddit\'s limit of 300 characters.',
    },
    {
        problem: "an alias to an anchor that does not exist",
        pageContent: ["name: aliased", "enabled: true", "title: Aliased", "maxComments: 5", "body: *missing"].join(
            "\n",
        ),
        subject: "Invalid YAML in wiki page stickymgr/config",
        bodyMarkdown:
            "\n/u/mod_user, the wiki page stickymgr/config contains invalid YAML. Please fix it.\n\n\nErrors:\n\n> Document 1: Unresolved alias (the anchor must be set before the alias): missing\n\n\nThe existing config will be used until the issue is resolved.\n",
        warnLog:
            "Rejected config page revision rev-2: invalid YAML: Document 1: Unresolved alias (the anchor must be set before the alias): missing.",
    },
];

describe("applyConfigPageRevision with an invalid config page", (): void => {
    it.for(PROBLEM_CASES)(
        "alerts moderators to $problem and keeps the stored thread configs",
        TEST_OPTIONS,
        async (problemCase: ProblemCase): Promise<void> => {
            expect.assertions(4);

            const warnSpy = silenceConsole("warn");
            const fakes = createFakeConfigurationPorts({ pageContent: problemCase.pageContent });

            await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("rejected");

            expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith({
                subject: problemCase.subject,
                bodyMarkdown: problemCase.bodyMarkdown,
            });
            expect(fakes.store.writeConfigs).not.toHaveBeenCalled();
            expect(warnSpy.mock.calls).toStrictEqual([[problemCase.warnLog]]);
        },
    );
});
