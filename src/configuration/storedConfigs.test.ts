import { describe, expect, it, vi } from "vitest";
import { createFakeConfigurationPorts } from "../../tests/support/fakeConfigurationPorts.js";
import type { ThreadConfig } from "./domain/threadConfig.js";
import { UnreadableConfigError } from "./ports.js";
import { getThreadConfigs, storeThreadConfigs } from "./storedConfigs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

const UNREADABLE_ERROR = new UnreadableConfigError("the stored copy is not JSON");

describe(getThreadConfigs, (): void => {
    it("returns an empty list and warns when no thread configs are stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const warnSpy = vi.spyOn(console, "warn").mockImplementation((): undefined => undefined);
        const fakes = createFakeConfigurationPorts();

        await expect(getThreadConfigs(fakes.ports)).resolves.toStrictEqual([]);
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith("No configuration found in storage. Returning empty config.");
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it("returns the stored thread configs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeConfigurationPorts({ storedConfigs: [MINIMAL_CONFIG] });

        await expect(getThreadConfigs(fakes.ports)).resolves.toStrictEqual([MINIMAL_CONFIG]);
    });

    it(
        "lets a failure other than an unreadable copy through without alerting",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeConfigurationPorts();
            const storeError = new Error("redis unavailable");
            fakes.store.readConfigs.mockRejectedValue(storeError);

            await expect(getThreadConfigs(fakes.ports)).rejects.toBe(storeError);
            expect(fakes.store.claimUnreadableAlert).not.toHaveBeenCalled();
        },
    );
});

describe("getThreadConfigs with an unreadable stored copy", (): void => {
    it("claims the alert, alerts moderators once and rejects", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeConfigurationPorts();
        fakes.store.readConfigs.mockRejectedValue(UNREADABLE_ERROR);

        await expect(getThreadConfigs(fakes.ports)).rejects.toBe(UNREADABLE_ERROR);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith({
            subject: "Sticky Manager cannot read its stored config",
            bodyMarkdown: [
                "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
                "Re-save the wiki page stickymgr/config to store a fresh copy.",
                "Details: the stored copy is not JSON",
            ].join("\n\n"),
        });
    });

    it("sends nothing when another reader has already claimed the alert", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeConfigurationPorts();
        fakes.store.readConfigs.mockRejectedValue(UNREADABLE_ERROR);
        fakes.store.claimUnreadableAlert.mockResolvedValue(false);

        await expect(getThreadConfigs(fakes.ports)).rejects.toBe(UNREADABLE_ERROR);
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it(
        "releases the claim and reports both failures when the alert cannot be sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeConfigurationPorts();
            fakes.store.readConfigs.mockRejectedValue(UNREADABLE_ERROR);
            const sendError = new Error("modmail unavailable");
            fakes.notifyModerators.mockRejectedValue(sendError);
            const reading = getThreadConfigs(fakes.ports);

            await expect(reading).rejects.toThrow(
                new Error(
                    "Could not alert moderators that the stored config cannot be read (the stored copy is not JSON)",
                ),
            );
            await expect(reading).rejects.toHaveProperty("cause", sendError);
            expect(fakes.store.releaseUnreadableAlert).toHaveBeenCalledExactlyOnceWith();
        },
    );
});

describe(storeThreadConfigs, (): void => {
    it(
        "stores the thread configs, then releases the alert claim so a later breakage alerts again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeConfigurationPorts();
            await storeThreadConfigs([MINIMAL_CONFIG], fakes.ports.store);

            expect(fakes.store.writeConfigs).toHaveBeenCalledExactlyOnceWith([MINIMAL_CONFIG]);
            expect(fakes.store.writeConfigs).toHaveBeenCalledBefore(fakes.store.releaseUnreadableAlert);
        },
    );
});
