import { describe, expect, it } from "vitest";
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
