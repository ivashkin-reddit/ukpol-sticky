import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import type { FakeRedis } from "../../../tests/support/fakeDevvitContext.js";
import type { ThreadConfig } from "../domain/threadConfig.js";
import { UnreadableConfigError } from "../ports.js";
import { redisConfigStore } from "./redisConfigStore.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

function redisStoring(stored: string | undefined): FakeRedis {
    const { redis } = createFakeDevvitContext();
    redis.get.mockResolvedValue(stored);
    return redis;
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

describe("redisConfigStore().readConfigs", (): void => {
    it("reads undefined when nothing is stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const redis = redisStoring(undefined);

        await expect(redisConfigStore(redis).readConfigs()).resolves.toBeUndefined();
        expect(redis.get).toHaveBeenCalledExactlyOnceWith("Configuration");
    });

    it("reads the stored thread configs when they are valid", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const redis = redisStoring(JSON.stringify([MINIMAL_CONFIG]));

        await expect(redisConfigStore(redis).readConfigs()).resolves.toStrictEqual([MINIMAL_CONFIG]);
    });

    it(
        "rejects as unreadable, keeping the parse error as the cause, when the stored text is not JSON",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const reading = redisConfigStore(redisStoring("{")).readConfigs();

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

            const reading = redisConfigStore(redisStoring("{}")).readConfigs();

            await expect(reading).rejects.toBeInstanceOf(UnreadableConfigError);
            await expect(reading).rejects.toThrow(
                new UnreadableConfigError(
                    'Stored configuration (Redis key "Configuration") is invalid: data must be array',
                ),
            );
        },
    );
});

describe(redisConfigStore, (): void => {
    it("writes thread configs as JSON", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const redis = redisStoring(undefined);
        await redisConfigStore(redis).writeConfigs([MINIMAL_CONFIG]);

        expect(redis.set).toHaveBeenCalledExactlyOnceWith("Configuration", JSON.stringify([MINIMAL_CONFIG]));
    });

    it("keeps the accepted revision under LastRevision", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const redis = redisStoring("rev-1");
        const store = redisConfigStore(redis);
        const accepted = await store.readAcceptedRevision();
        await store.writeAcceptedRevision("rev-2");

        expect(accepted).toBe("rev-1");
        expect(redis.get).toHaveBeenCalledExactlyOnceWith("LastRevision");
        expect(redis.set).toHaveBeenCalledExactlyOnceWith("LastRevision", "rev-2");
    });

    it("keeps the rejected revision under LastRejectedRevision", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const redis = redisStoring("rev-3");
        const store = redisConfigStore(redis);
        const rejected = await store.readRejectedRevision();
        await store.writeRejectedRevision("rev-4");

        expect(rejected).toBe("rev-3");
        expect(redis.get).toHaveBeenCalledExactlyOnceWith("LastRejectedRevision");
        expect(redis.set).toHaveBeenCalledExactlyOnceWith("LastRejectedRevision", "rev-4");
    });
});
