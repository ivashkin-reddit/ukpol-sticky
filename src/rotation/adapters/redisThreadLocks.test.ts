import { describe, expect, it } from "vitest";
import { freezeTime } from "../../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { silenceConsole } from "../../../tests/support/silenceConsole.js";
import { redisThreadLocks } from "./redisThreadLocks.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisThreadLocks, (): void => {
    it(
        "takes a lock with an NX write of a token that expires after two minutes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            freezeTime("2026-04-21T10:00:00Z");
            const { redis } = createFakeDevvitContext();

            await expect(redisThreadLocks(redis).tryLock("daily-thread")).resolves.toBe(true);
            expect(redis.set.mock.lastCall?.[0]).toBe("ThreadLock:daily-thread");
            // The time it was taken, then a random part that tells apart two invocations in the same millisecond.
            expect(redis.set.mock.lastCall?.[1]).toMatch(/^2026-04-21T10:00:00\.000Z [\da-z]+$/v);
            expect(redis.set.mock.lastCall?.[2]).toStrictEqual({
                nx: true,
                expiration: new Date("2026-04-21T10:02:00.000Z"),
            });
        },
    );

    it("reports the lock held when Redis declines the NX write", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        // Redis answers a declined NX write with nil, which Devvit returns as "".
        redis.set.mockResolvedValue("");

        await expect(redisThreadLocks(redis).tryLock("daily-thread")).resolves.toBe(false);
    });

    it(
        "unlocks by deleting its own lock in a transaction watching the lock's key",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { redis } = createFakeDevvitContext();
            const locks = redisThreadLocks(redis);
            await locks.tryLock("daily-thread");
            redis.get.mockResolvedValue(redis.set.mock.lastCall?.[1]);

            await locks.unlock("daily-thread");

            expect(redis.watch).toHaveBeenCalledExactlyOnceWith("ThreadLock:daily-thread");
            expect(redis.transaction.del).toHaveBeenCalledExactlyOnceWith("ThreadLock:daily-thread");
            expect(redis.transaction.multi).toHaveBeenCalledBefore(redis.transaction.del);
            expect(redis.transaction.exec).toHaveBeenCalledAfter(redis.transaction.del);
        },
    );

    it(
        "leaves a lock that expired and passed to another invocation, and logs that it was lost",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const errorSpy = silenceConsole("error");
            const { redis } = createFakeDevvitContext();
            const locks = redisThreadLocks(redis);
            await locks.tryLock("daily-thread");
            redis.get.mockResolvedValue("2026-04-21T10:02:01.000Z another-invocation");

            await locks.unlock("daily-thread");

            expect(redis.transaction.del).not.toHaveBeenCalled();
            expect(redis.transaction.exec).not.toHaveBeenCalled();
            expect(redis.transaction.unwatch).toHaveBeenCalledExactlyOnceWith();
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "The lock on thread config daily-thread expired before its refresh finished, so another refresh of it may have run at the same time.",
            );
        },
    );

    it("does nothing when asked to unlock a lock it does not hold", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisThreadLocks(redis).unlock("daily-thread");

        expect(redis.watch).not.toHaveBeenCalled();
    });
});
