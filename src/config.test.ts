import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../tests/support/fakeClock.js";
import { createFakeStickyContext } from "../tests/support/fakeStickyContext.js";
import type { FakeStickyContext } from "../tests/support/fakeStickyContext.js";
import { getConfig, parsePostTime, storeConfig, UnreadableConfigError, validateConfigList } from "./config.js";
import type { Config } from "./config.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: Config = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

const SCHEMA_ERROR_MESSAGE = 'Stored configuration (Redis key "Configuration") is invalid: data must be array';

function fakesStoring(stored: string | undefined): FakeStickyContext {
    const fakes = createFakeStickyContext();
    fakes.redis.get.mockResolvedValue(stored);
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

describe(getConfig, (): void => {
    it("returns an empty list and warns when no config is stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const warnSpy = vi.spyOn(console, "warn").mockImplementation((): undefined => undefined);
        const fakes = fakesStoring(undefined);

        await expect(getConfig(fakes.context)).resolves.toStrictEqual([]);
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith("No configuration found in storage. Returning empty config.");
        expect(fakes.reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    });

    it(
        "rejects as unreadable, keeping the parse error as the cause, when the stored text is not JSON",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const reading = getConfig(fakesStoring("{").context);

            await expect(reading).rejects.toThrow(
                new UnreadableConfigError(
                    `Stored configuration (Redis key "Configuration") is not JSON: ${syntaxErrorFrom("{").message}`,
                ),
            );
            await expect(reading).rejects.toHaveProperty("cause", syntaxErrorFrom("{"));
        },
    );

    it("rejects as unreadable when the stored JSON is not a config list", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const reading = getConfig(fakesStoring("{}").context);

        await expect(reading).rejects.toBeInstanceOf(UnreadableConfigError);
        await expect(reading).rejects.toThrow(new UnreadableConfigError(SCHEMA_ERROR_MESSAGE));
    });

    it("returns the stored configs when they are valid", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await expect(getConfig(fakesStoring(JSON.stringify([MINIMAL_CONFIG])).context)).resolves.toStrictEqual([
            MINIMAL_CONFIG,
        ]);
    });
});

describe("getConfig with an unreadable stored config", (): void => {
    it("claims the alert with NX and sends moderators one modmail", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        freezeTime("2026-04-21T10:00:00Z");
        const fakes = fakesStoring("{}");

        await expect(getConfig(fakes.context)).rejects.toBeInstanceOf(UnreadableConfigError);
        expect(fakes.redis.set).toHaveBeenCalledExactlyOnceWith(
            "UnreadableConfigAlertSent",
            "2026-04-21T10:00:00.000Z",
            { nx: true },
        );
        expect(fakes.reddit.modMail.createModInboxConversation).toHaveBeenCalledExactlyOnceWith({
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
        fakes.redis.set.mockResolvedValue("");

        await expect(getConfig(fakes.context)).rejects.toThrow(new UnreadableConfigError(SCHEMA_ERROR_MESSAGE));
        expect(fakes.reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    });

    it(
        "releases the claim and reports both failures when the modmail cannot be sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = fakesStoring("{}");
            const sendError = new Error("modmail unavailable");
            fakes.reddit.modMail.createModInboxConversation.mockRejectedValue(sendError);
            const reading = getConfig(fakes.context);

            await expect(reading).rejects.toThrow(
                new Error(`Could not alert moderators that the stored config cannot be read (${SCHEMA_ERROR_MESSAGE})`),
            );
            await expect(reading).rejects.toHaveProperty("cause", sendError);
            expect(fakes.redis.del).toHaveBeenCalledExactlyOnceWith("UnreadableConfigAlertSent");
        },
    );
});

describe(storeConfig, (): void => {
    it(
        "stores the configs and clears the alert claim, so a later breakage alerts again",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeStickyContext();
            await storeConfig(fakes.context, [MINIMAL_CONFIG]);

            expect(fakes.redis.set).toHaveBeenCalledExactlyOnceWith("Configuration", JSON.stringify([MINIMAL_CONFIG]));
            expect(fakes.redis.del).toHaveBeenCalledExactlyOnceWith("UnreadableConfigAlertSent");
        },
    );
});

describe(validateConfigList, (): void => {
    it.for(["postTime", "sticky", "endNote", "lockOnRefresh"])(
        "accepts null for the optional key %s",
        TEST_OPTIONS,
        (key: string): void => {
            expect.assertions(1);

            const config = { ...MINIMAL_CONFIG, [key]: null };

            expect(validateConfigList([config])).toStrictEqual({ kind: "valid", configs: [config] });
        },
    );

    it("rejects null for frequency, which is not one of its allowed values", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(validateConfigList([{ ...MINIMAL_CONFIG, frequency: null }])).toStrictEqual({
            kind: "invalid",
            errors: "data/0/frequency must be equal to one of the allowed values",
        });
    });

    it("rejects a maxComments below 1", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(validateConfigList([{ ...MINIMAL_CONFIG, maxComments: 0 }])).toStrictEqual({
            kind: "invalid",
            errors: "data/0/maxComments must be >= 1",
        });
    });
});

describe(parsePostTime, (): void => {
    it("parses a 24-hour HH:mm time", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(parsePostTime("23:05")).toStrictEqual({ hours: 23, minutes: 5 });
    });

    it.for(["7:05", "24:00", "12:60", "12:30 "])("rejects %j", TEST_OPTIONS, (postTime: string): void => {
        expect.assertions(1);

        expect((): void => {
            parsePostTime(postTime);
        }).toThrow(new RangeError(`postTime "${postTime}" is not in HH:mm format.`));
    });
});
