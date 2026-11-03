import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createConfigPageFakes } from "../../tests/support/fakeConfigPageContext.js";
import type { ConfigPageFakes } from "../../tests/support/fakeConfigPageContext.js";
import { getThreadConfigs, storeThreadConfigs, UnreadableConfigError } from "./configStore.js";
import type { ThreadConfig } from "./threadConfig.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

const SCHEMA_ERROR_MESSAGE = 'Stored configuration (Redis key "Configuration") is invalid: data must be array';

function fakesStoring(stored: string | undefined): ConfigPageFakes {
    const fakes = createConfigPageFakes();
    fakes.redisGet.mockResolvedValue(stored);
    return fakes;
}

function syntaxErrorFrom(text: string): SyntaxError {
    try {
        JSON.parse(text);
    } catch (error: unknown) {
        if (error instanceof SyntaxError) {
            return error;
        }
    }

    throw new Error(`Expected JSON.parse to reject ${text}`);
}

describe(getThreadConfigs, (): void => {
    it("returns an empty list and warns when no thread configs are stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const warnSpy = vi.spyOn(console, "warn").mockImplementation((): undefined => undefined);
        const fakes = fakesStoring(undefined);

        await expect(getThreadConfigs(fakes.context)).resolves.toStrictEqual([]);
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith("No configuration found in storage. Returning empty config.");
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it(
        "rejects as unreadable, keeping the parse error as the cause, when the stored text is not JSON",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const reading = getThreadConfigs(fakesStoring("{").context);

            await expect(reading).rejects.toThrow(
                new UnreadableConfigError(
                    `Stored configuration (Redis key "Configuration") is not JSON: ${syntaxErrorFrom("{").message}`,
                ),
            );
            await expect(reading).rejects.toHaveProperty("cause", syntaxErrorFrom("{"));
        },
    );

    it(
        "rejects as unreadable when the stored JSON is not a list of thread configs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const reading = getThreadConfigs(fakesStoring("{}").context);

            await expect(reading).rejects.toBeInstanceOf(UnreadableConfigError);
            await expect(reading).rejects.toThrow(new UnreadableConfigError(SCHEMA_ERROR_MESSAGE));
        },
    );

    it("returns the stored thread configs when they are valid", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await expect(getThreadConfigs(fakesStoring(JSON.stringify([MINIMAL_CONFIG])).context)).resolves.toStrictEqual([
            MINIMAL_CONFIG,
        ]);
    });
});

describe("getThreadConfigs with an unreadable stored copy", (): void => {
    it("claims the alert with NX and alerts moderators once", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        freezeTime("2026-04-21T10:00:00Z");
        const fakes = fakesStoring("{}");

        await expect(getThreadConfigs(fakes.context)).rejects.toBeInstanceOf(UnreadableConfigError);
        expect(fakes.redisSet).toHaveBeenCalledExactlyOnceWith(
            "UnreadableConfigAlertSent",
            "2026-04-21T10:00:00.000Z",
            { nx: true },
        );
        expect(fakes.createModInboxConversation).toHaveBeenCalledExactlyOnceWith({
            subredditId: "t5_testsub",
            subject: "Sticky Manager cannot read its stored config",
            bodyMarkdown: [
                "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
                "Re-save the wiki page stickymgr/config to store a fresh copy.",
                `Details: ${SCHEMA_ERROR_MESSAGE}`,
            ].join("\n\n"),
        });
    });

    it("sends nothing when another reader has already claimed the alert", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = fakesStoring("{}");
        // Redis answers a declined NX write with nil, which Devvit returns as "".
        fakes.redisSet.mockResolvedValue("");

        await expect(getThreadConfigs(fakes.context)).rejects.toThrow(new UnreadableConfigError(SCHEMA_ERROR_MESSAGE));
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it(
        "releases the claim and reports both failures when the alert cannot be sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = fakesStoring("{}");
            const sendError = new Error("modmail unavailable");
            fakes.createModInboxConversation.mockRejectedValue(sendError);
            const reading = getThreadConfigs(fakes.context);

            await expect(reading).rejects.toThrow(
                new Error(`Could not alert moderators that the stored config cannot be read (${SCHEMA_ERROR_MESSAGE})`),
            );
            await expect(reading).rejects.toHaveProperty("cause", sendError);
            expect(fakes.redisDel).toHaveBeenCalledExactlyOnceWith("UnreadableConfigAlertSent");
        },
    );
});

describe(storeThreadConfigs, (): void => {
    it(
        "stores the thread configs and clears the alert claim, so a later breakage alerts again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createConfigPageFakes();
            await storeThreadConfigs(fakes.context, [MINIMAL_CONFIG]);

            expect(fakes.redisSet).toHaveBeenCalledExactlyOnceWith("Configuration", JSON.stringify([MINIMAL_CONFIG]));
            expect(fakes.redisDel).toHaveBeenCalledExactlyOnceWith("UnreadableConfigAlertSent");
        },
    );
});
