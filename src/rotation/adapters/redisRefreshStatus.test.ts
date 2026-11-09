import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisRefreshStatus } from "./redisRefreshStatus.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const AT = new Date("2026-04-21T12:30:05.000Z");

describe(redisRefreshStatus, (): void => {
    it(
        "records a thread config's success under its own key, clearing any earlier failure",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { redis } = createFakeDevvitContext();
            await redisRefreshStatus(redis).recordSuccess("daily-thread", AT);

            expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", {
                lastRefreshAt: "2026-04-21T12:30:05.000Z",
                lastRefreshOutcome: "succeeded",
                lastSuccessAt: "2026-04-21T12:30:05.000Z",
            });
            expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", ["lastRefreshFailure"]);
        },
    );

    it("records a failure, keeping the last success", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisRefreshStatus(redis).recordFailure("daily-thread", AT, "Reddit is down");

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", {
            lastRefreshAt: "2026-04-21T12:30:05.000Z",
            lastRefreshOutcome: "failed",
            lastRefreshFailure: "Reddit is down",
        });
    });

    it("records when the next refresh is due, or that none is scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        const refreshStatus = redisRefreshStatus(redis);
        await refreshStatus.recordNextRefresh("daily-thread", AT);
        await refreshStatus.recordNextRefresh("daily-thread", undefined);

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", {
            nextRefreshAt: "2026-04-21T12:30:05.000Z",
        });
        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", ["nextRefreshAt"]);
    });

    it(
        "reads each named thread config's status, an unrecorded one as empty and a bad date as absent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { redis } = createFakeDevvitContext();
            redis.hGetAll.mockImplementation(
                async (key: string): Promise<Record<string, string>> =>
                    await Promise.resolve(
                        key === "RefreshStatus:daily-thread"
                            ? {
                                  lastRefreshAt: "2026-04-21T12:30:05.000Z",
                                  lastRefreshOutcome: "failed",
                                  lastRefreshFailure: "Reddit is down",
                                  lastSuccessAt: "not a date",
                                  nextRefreshAt: "2026-04-21T12:45:05.000Z",
                              }
                            : {},
                    ),
            );

            await expect(redisRefreshStatus(redis).read(["daily-thread", "weekly-thread"])).resolves.toStrictEqual({
                "daily-thread": {
                    lastRefresh: { at: AT, outcome: "failed", failure: "Reddit is down" },
                    lastSuccessAt: undefined,
                    nextRefreshAt: new Date("2026-04-21T12:45:05.000Z"),
                },
                "weekly-thread": { lastRefresh: undefined, lastSuccessAt: undefined, nextRefreshAt: undefined },
            });
        },
    );

    it(
        "forgets the named thread configs' status, and touches nothing for none",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { redis } = createFakeDevvitContext();
            const refreshStatus = redisRefreshStatus(redis);
            await refreshStatus.forget([]);
            await refreshStatus.forget(["daily-thread", "weekly-thread"]);

            expect(redis.del).toHaveBeenCalledExactlyOnceWith(
                "RefreshStatus:daily-thread",
                "RefreshStatus:weekly-thread",
            );
        },
    );
});
