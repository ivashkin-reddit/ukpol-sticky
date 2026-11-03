import { describe, expect, it } from "vitest";
import { freezeTime } from "../../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisAlertLatch } from "./redisAlertLatch.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisAlertLatch, (): void => {
    it(
        "claims the latch with an NX write of the time that lapses after ten minutes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const { redis } = createFakeDevvitContext();

            await expect(redisAlertLatch(redis, "SomeAlertSent").claim()).resolves.toBe(true);
            expect(redis.set).toHaveBeenCalledExactlyOnceWith("SomeAlertSent", "2026-04-21T10:00:00.000Z", {
                nx: true,
                expiration: new Date("2026-04-21T10:10:00.000Z"),
            });
        },
    );

    it("reports the latch already claimed when Redis declines the NX write", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        // Redis answers a declined NX write with nil, which Devvit returns as "".
        redis.set.mockResolvedValue("");

        await expect(redisAlertLatch(redis, "SomeAlertSent").claim()).resolves.toBe(false);
    });

    it(
        "confirms the claim with a plain write of the time, which drops the claim's expiry",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:05Z");
            const { redis } = createFakeDevvitContext();
            await redisAlertLatch(redis, "SomeAlertSent").confirm();

            expect(redis.set).toHaveBeenCalledExactlyOnceWith("SomeAlertSent", "2026-04-21T10:00:05.000Z");
        },
    );

    it("releases the latch by deleting its key", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisAlertLatch(redis, "SomeAlertSent").release();

        expect(redis.del).toHaveBeenCalledExactlyOnceWith("SomeAlertSent");
    });
});
