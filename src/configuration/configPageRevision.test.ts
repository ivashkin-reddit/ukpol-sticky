import { describe, expect, it } from "vitest";
import { createFakeConfigurationPorts } from "../../tests/support/fakeConfigurationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { applyConfigPageRevision } from "./configPageRevision.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(applyConfigPageRevision, (): void => {
    it("reports the page unavailable when it cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeConfigurationPorts();
        fakes.page.read.mockResolvedValue(undefined);

        await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("unavailable");
        expect(fakes.store.writeConfigs).not.toHaveBeenCalled();
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it("logs and reports no change when the revision was already accepted", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = silenceConsole("log");
        const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-2" });

        await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("unchanged");
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("Config page revision rev-2 is already accepted.");
        expect(fakes.store.writeAcceptedRevision).not.toHaveBeenCalled();
    });

    it(
        "records the revision, then stores its thread configs and releases the alert claim",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-1" });

            await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("stored");
            expect(fakes.store.writeAcceptedRevision).toHaveBeenCalledExactlyOnceWith("rev-2");
            expect(fakes.store.writeConfigs).toHaveBeenCalledExactlyOnceWith([
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
            ]);
            expect(fakes.store.writeAcceptedRevision).toHaveBeenCalledBefore(fakes.store.writeConfigs);
            expect(fakes.unreadableAlert.release).toHaveBeenCalledExactlyOnceWith();
        },
    );

    it("stores keys left empty in YAML as null", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeConfigurationPorts({
            pageContent: [
                "name: cap-thread",
                "enabled: true",
                "title: Cap",
                "maxComments: 5",
                "body: b",
                "endNote:",
            ].join("\n"),
        });

        await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("stored");
        expect(fakes.store.writeConfigs).toHaveBeenCalledExactlyOnceWith([
            { name: "cap-thread", enabled: true, title: "Cap", maxComments: 5, body: "b", endNote: null },
        ]);
    });
});
