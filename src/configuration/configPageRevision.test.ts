import { describe, expect, it } from "vitest";
import { createFakeConfigurationPorts, VALID_CONFIG_PAGE } from "../../tests/support/fakeConfigurationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { applyConfigPageRevision } from "./configPageRevision.js";
import type { ConfigPageRevision } from "./ports.js";

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
        "stores the revision's thread configs and releases the alert claim, then records the revision",
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
            expect(fakes.store.writeConfigs).toHaveBeenCalledBefore(fakes.store.writeAcceptedRevision);
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

    it(
        "leaves the revision unaccepted when storing its thread configs fails, so applying it again stores them",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-1" });
            const storeError = new Error("redis unavailable");
            fakes.store.writeConfigs.mockRejectedValueOnce(storeError);

            await expect(applyConfigPageRevision("mod_user", fakes.ports)).rejects.toBe(storeError);
            expect(fakes.store.writeAcceptedRevision).not.toHaveBeenCalled();
            await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("stored");
        },
    );

    it(
        "remembers a rejected revision, so later wiki revisions elsewhere do not alert moderators to it again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            silenceConsole("warn");
            const logSpy = silenceConsole("log");
            const fakes = createFakeConfigurationPorts({ pageContent: "name: incomplete" });

            await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("rejected");
            expect(fakes.store.writeRejectedRevision).toHaveBeenCalledExactlyOnceWith("rev-2");

            fakes.store.readRejectedRevision.mockResolvedValue("rev-2");

            await expect(applyConfigPageRevision("other_mod", fakes.ports)).resolves.toBe("unchanged");
            expect(logSpy).toHaveBeenCalledExactlyOnceWith("Config page revision rev-2 is already rejected.");
        },
    );
});

describe("applyConfigPageRevision with saves close together", (): void => {
    it(
        "applies a newer revision saved while it stored an older one, so the newest stays in force",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-1" });
            // The page read first shows rev-2; by the time it is stored, a moderator has saved rev-3.
            fakes.page.read
                .mockResolvedValueOnce({ content: VALID_CONFIG_PAGE, revisionId: "rev-2" })
                .mockResolvedValue({ content: VALID_CONFIG_PAGE, revisionId: "rev-3" });

            await expect(applyConfigPageRevision("mod_user", fakes.ports)).resolves.toBe("stored");
            expect(fakes.store.writeAcceptedRevision.mock.calls).toStrictEqual([["rev-2"], ["rev-3"]]);
            expect(fakes.store.writeConfigs).toHaveBeenCalledTimes(2);
        },
    );

    it(
        "applies at most three revisions at a time, should moderators keep saving",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = createFakeConfigurationPorts({ acceptedRevision: "rev-1" });
            let revision = 1;
            fakes.page.read.mockImplementation(async (): Promise<ConfigPageRevision> => {
                revision += 1;
                return await Promise.resolve({ content: VALID_CONFIG_PAGE, revisionId: `rev-${String(revision)}` });
            });

            await applyConfigPageRevision("mod_user", fakes.ports);

            expect(fakes.store.writeAcceptedRevision.mock.calls).toStrictEqual([["rev-2"], ["rev-3"], ["rev-4"]]);
        },
    );
});

describe("applyConfigPageRevision rejection alerts", (): void => {
    it("are addressed to the moderator who saved the revision", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("warn");
        const fakes = createFakeConfigurationPorts();
        fakes.page.read.mockResolvedValue({ content: "name: x", revisionId: "rev-2", authorName: "author_mod" });

        await applyConfigPageRevision("event_mod", fakes.ports);

        expect(
            fakes.notifyModerators.mock.lastCall?.[0].bodyMarkdown
                .trimStart()
                .startsWith("/u/author_mod, the config in wiki page stickymgr/config is invalid."),
        ).toBe(true);
    });

    it(
        "fall back to the moderator the wiki revision event names when the revision names nobody",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("warn");
            const fakes = createFakeConfigurationPorts({ pageContent: "name: x" });

            await applyConfigPageRevision("event_mod", fakes.ports);

            expect(
                fakes.notifyModerators.mock.lastCall?.[0].bodyMarkdown
                    .trimStart()
                    .startsWith("/u/event_mod, the config"),
            ).toBe(true);
        },
    );

    it("address moderators at large when nobody's name is known", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("warn");
        const fakes = createFakeConfigurationPorts({ pageContent: "name: x" });

        await applyConfigPageRevision(undefined, fakes.ports);

        expect(
            fakes.notifyModerators.mock.lastCall?.[0].bodyMarkdown
                .trimStart()
                .startsWith("Moderators, the config in wiki page stickymgr/config is invalid."),
        ).toBe(true);
    });
});
