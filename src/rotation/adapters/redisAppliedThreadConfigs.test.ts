import { describe, expect, it, vi } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import type { ThreadConfig } from "../../configuration/index.js";
import { redisAppliedThreadConfigs } from "./redisAppliedThreadConfigs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CONFIG: ThreadConfig = { name: "daily-thread", enabled: true, title: "Daily", maxComments: 100, body: "Body" };

describe(redisAppliedThreadConfigs, (): void => {
    it("matches a thread config against the version recorded under its name", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const { redis } = createFakeDevvitContext();
        redis.hGet.mockResolvedValue(JSON.stringify(CONFIG));
        const applied = redisAppliedThreadConfigs(redis);

        await expect(applied.matches(CONFIG)).resolves.toBe(true);
        await expect(applied.matches({ ...CONFIG, body: "Edited body" })).resolves.toBe(false);
        expect(redis.hGet).toHaveBeenLastCalledWith("AppliedThreadConfigsByName", "daily-thread");
    });

    it(
        "matches nothing before a refresh of the thread config recorded a version",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { redis } = createFakeDevvitContext();

            await expect(redisAppliedThreadConfigs(redis).matches(CONFIG)).resolves.toBe(false);
        },
    );

    it("reads back the version recorded under a name", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        redis.hGet.mockResolvedValue(JSON.stringify({ ...CONFIG, slot: 2 }));

        await expect(redisAppliedThreadConfigs(redis).read("daily-thread")).resolves.toStrictEqual({
            ...CONFIG,
            slot: 2,
        });
        expect(redis.hGet).toHaveBeenCalledExactlyOnceWith("AppliedThreadConfigsByName", "daily-thread");
    });

    it("reads undefined when no version is recorded", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();

        await expect(redisAppliedThreadConfigs(redis).read("daily-thread")).resolves.toBeUndefined();
    });

    it.for([
        ["not JSON", "not json", "data/0 must be object"],
        ["not a thread config", '{"name":"x"}', "data/0 must have required property 'enabled'"],
    ])(
        "reads %s as undefined, and warns",
        TEST_OPTIONS,
        async ([, stored, errors]: readonly string[]): Promise<void> => {
            expect.assertions(2);

            const warn = vi.spyOn(console, "warn").mockImplementation((): undefined => undefined);
            const { redis } = createFakeDevvitContext();
            redis.hGet.mockResolvedValue(stored);

            await expect(redisAppliedThreadConfigs(redis).read("daily-thread")).resolves.toBeUndefined();
            expect(warn).toHaveBeenCalledExactlyOnceWith(
                `The applied version of thread config daily-thread cannot be read, so its pin is left as it is: ${String(errors)}`,
            );
        },
    );

    it("records a thread config under its name, as JSON", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisAppliedThreadConfigs(redis).record(CONFIG);

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("AppliedThreadConfigsByName", {
            "daily-thread": JSON.stringify(CONFIG),
        });
    });

    it("lists the names of the thread configs recorded", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        redis.hKeys.mockResolvedValue(["daily-thread", "weekly-thread"]);

        await expect(redisAppliedThreadConfigs(redis).configNames()).resolves.toStrictEqual([
            "daily-thread",
            "weekly-thread",
        ]);
    });

    it("forgets the named thread configs, and touches nothing for none", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        const applied = redisAppliedThreadConfigs(redis);
        await applied.forget([]);
        await applied.forget(["daily-thread", "weekly-thread"]);

        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("AppliedThreadConfigsByName", [
            "daily-thread",
            "weekly-thread",
        ]);
    });
});
