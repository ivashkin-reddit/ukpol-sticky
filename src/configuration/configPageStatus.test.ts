import { describe, expect, it } from "vitest";
import { createFakeConfigurationPorts, VALID_CONFIG_PAGE } from "../../tests/support/fakeConfigurationPorts.js";
import { DAILY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { writesMade } from "../../tests/support/writes.js";
import { getConfigPageStatus } from "./configPageStatus.js";
import { UnreadableConfigError } from "./ports.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const INCOMPLETE_SCHEDULE_PAGE = [
    "name: x",
    "enabled: true",
    "title: X",
    "frequency: daily",
    "maxComments: 10",
    "body: hi",
].join("\n");

describe(getConfigPageStatus, (): void => {
    it(
        "shows the latest revision in force, with who saved it, and the stored thread configs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-2", storedConfigs: [DAILY_CONFIG] });
            fakes.page.read.mockResolvedValue({
                content: VALID_CONFIG_PAGE,
                revisionId: "rev-2",
                authorName: "mod_user",
            });

            await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
                page: { kind: "inForce", savedBy: "mod_user" },
                threadConfigs: { kind: "readable", configs: [DAILY_CONFIG] },
            });
            expect(writesMade(fakes.writes)).toStrictEqual([]);
        },
    );

    it("shows a rejected latest revision with its config problem", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeConfigurationPorts({
            acceptedRevision: "rev-1",
            pageContent: INCOMPLETE_SCHEDULE_PAGE,
        });
        fakes.store.readRejectedRevision.mockResolvedValue("rev-2");

        await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
            page: { kind: "rejected", problem: { kind: "incompleteSchedule", configName: "x" } },
            threadConfigs: { kind: "readable", configs: [] },
        });
    });

    it(
        "shows a rejected revision that the checks now pass with no problem, for a save to apply",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const fakes = createFakeConfigurationPorts();
            fakes.store.readRejectedRevision.mockResolvedValue("rev-2");

            await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
                page: { kind: "rejected", problem: undefined },
                threadConfigs: { kind: "readable", configs: [] },
            });
        },
    );

    it("shows a revision neither accepted nor rejected as not yet checked", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-1" });

        await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
            page: { kind: "unchecked" },
            threadConfigs: { kind: "readable", configs: [] },
        });
    });

    it("shows a config page that cannot be read as unavailable", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeConfigurationPorts({ storedConfigs: [DAILY_CONFIG] });
        fakes.page.read.mockResolvedValue(undefined);

        await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
            page: { kind: "unavailable" },
            threadConfigs: { kind: "readable", configs: [DAILY_CONFIG] },
        });
    });

    it(
        "reports stored thread configs that cannot be read, without alerting moderators",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-2" });
            fakes.store.readConfigs.mockRejectedValue(new UnreadableConfigError("not JSON"));

            await expect(getConfigPageStatus(fakes.ports)).resolves.toStrictEqual({
                page: { kind: "inForce", savedBy: undefined },
                threadConfigs: { kind: "unreadable" },
            });
            expect(writesMade(fakes.writes)).toStrictEqual([]);
        },
    );

    it("passes on any other failure to read the stored thread configs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const failure = new Error("Redis is down");
        const fakes = createFakeConfigurationPorts();
        fakes.store.readConfigs.mockRejectedValue(failure);

        await expect(getConfigPageStatus(fakes.ports)).rejects.toBe(failure);
    });
});
