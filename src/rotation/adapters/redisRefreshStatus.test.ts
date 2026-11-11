import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import type { NextRefreshReason } from "../domain/refreshRules.js";
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

    it(
        "records when the next refresh is due and why, or that none is scheduled",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { redis } = createFakeDevvitContext();
            const refreshStatus = redisRefreshStatus(redis);
            await refreshStatus.recordNextRefresh("daily-thread", { at: AT, reason: "to rotate it" });
            await refreshStatus.recordNextRefresh("daily-thread", undefined);

            expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", {
                nextRefreshAt: "2026-04-21T12:30:05.000Z",
                nextRefreshReason: "rotate",
            });
            expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", [
                "nextRefreshAt",
                "nextRefreshReason",
            ]);
        },
    );

    it.for<readonly [NextRefreshReason, string]>([
        ["to apply its stored thread config", "apply"],
        ["to retry it after a failure", "retry"],
        ["to publish its live post", "publish"],
        ["to finish its handover", "handover"],
        ["to rotate it", "rotate"],
        ["requested", "requested"],
    ])(
        "stores the reason %s as the stable code %s, and reads it back",
        TEST_OPTIONS,
        async ([reason, code]: readonly [NextRefreshReason, string]): Promise<void> => {
            expect.assertions(2);

            const { redis } = createFakeDevvitContext();
            const refreshStatus = redisRefreshStatus(redis);
            await refreshStatus.recordNextRefresh("daily-thread", { at: AT, reason });
            redis.hGetAll.mockResolvedValue({ nextRefreshAt: "2026-04-21T12:30:05.000Z", nextRefreshReason: code });

            expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus:daily-thread", {
                nextRefreshAt: "2026-04-21T12:30:05.000Z",
                nextRefreshReason: code,
            });
            await expect(refreshStatus.read(["daily-thread"])).resolves.toStrictEqual({
                "daily-thread": {
                    lastRefresh: undefined,
                    lastSuccessAt: undefined,
                    nextRefreshAt: AT,
                    nextRefreshReason: reason,
                },
            });
        },
    );

    it(
        "reads each named thread config's status, an unrecorded one as empty, and a bad date or unknown reason as absent",
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
                                  nextRefreshReason: "no-such-code",
                              }
                            : {},
                    ),
            );

            await expect(redisRefreshStatus(redis).read(["daily-thread", "weekly-thread"])).resolves.toStrictEqual({
                "daily-thread": {
                    lastRefresh: { at: AT, outcome: "failed", failure: "Reddit is down" },
                    lastSuccessAt: undefined,
                    nextRefreshAt: new Date("2026-04-21T12:45:05.000Z"),
                    nextRefreshReason: undefined,
                },
                "weekly-thread": {
                    lastRefresh: undefined,
                    lastSuccessAt: undefined,
                    nextRefreshAt: undefined,
                    nextRefreshReason: undefined,
                },
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
