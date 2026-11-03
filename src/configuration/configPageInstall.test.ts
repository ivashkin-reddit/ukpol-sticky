import { describe, expect, it } from "vitest";
import { createFakeConfigurationPorts } from "../../tests/support/fakeConfigurationPorts.js";
import { installConfigPage } from "./configPageInstall.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(installConfigPage, (): void => {
    it("installs the commented example on the config page", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeConfigurationPorts();
        await installConfigPage(fakes.ports.page);

        // One install, of the template that starts with this heading.
        expect(
            fakes.page.install.mock.calls.map(
                ([content]: readonly [string]): string | undefined => content.split("\n", 1)[0],
            ),
        ).toStrictEqual(["# Sticky Manager configuration file"]);
    });
});
