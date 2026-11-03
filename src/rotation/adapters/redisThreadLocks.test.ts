import { describe, expect, it } from "vitest";
import { freezeTime } from "../../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisThreadLocks } from "./redisThreadLocks.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisThreadLocks, (): void => {
    it("takes a lock with an NX write that expires after two minutes", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T10:00:00Z");
        const { redis } = createFakeDevvitContext();

        await expect(redisThreadLocks(redis).tryLock("daily-thread")).resolves.toBe(true);
        expect(redis.set).toHaveBeenCalledExactlyOnceWith("ThreadLock:daily-thread", "2026-04-21T10:00:00.000Z", {
            nx: true,
            expiration: new Date("2026-04-21T10:02:00.000Z"),
        });
    });

    it("reports the lock held when Redis declines the NX write", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        // Redis answers a declined NX write with nil, which Devvit returns as "".
        redis.set.mockResolvedValue("");

        await expect(redisThreadLocks(redis).tryLock("daily-thread")).resolves.toBe(false);
    });

    it("unlocks by deleting the lock's key", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisThreadLocks(redis).unlock("daily-thread");

        expect(redis.del).toHaveBeenCalledExactlyOnceWith("ThreadLock:daily-thread");
    });
});
