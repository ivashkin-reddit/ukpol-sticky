import { describe, expect, it } from "vitest";
import { VALID_CONFIG_PAGE } from "../../tests/support/fakeConfigurationPorts.js";
import { checkConfigPage } from "./configPageCheck.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(checkConfigPage, (): void => {
    it("accepts a valid page's thread configs, dropping empty documents", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkConfigPage(`---\n${VALID_CONFIG_PAGE}\n---\n`)).toStrictEqual({
            kind: "valid",
            configs: [
                {
                    name: "daily-thread",
                    enabled: true,
                    title: "Daily thread",
                    frequency: "daily",
                    postTime: "12:30",
                    sticky: true,
                    maxComments: 200,
                    body: "Hello world\n",
                },
            ],
        });
    });

    it("reports invalid YAML as its own problem, with each error", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const check = checkConfigPage("name: [unclosed");

        expect(check.kind === "invalid" ? check.problem.kind : check.kind).toBe("invalidYaml");
    });

    it("reports a thread config's problem as the config checks find it", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const page = ["name: x", "enabled: true", "title: X", "frequency: daily", "maxComments: 10", "body: hi"].join(
            "\n",
        );

        expect(checkConfigPage(page)).toStrictEqual({
            kind: "invalid",
            problem: { kind: "incompleteSchedule", configName: "x" },
        });
    });
});
