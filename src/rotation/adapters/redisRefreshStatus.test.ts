import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisRefreshStatus } from "./redisRefreshStatus.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const AT = new Date("2026-04-21T12:30:05.000Z");

describe(redisRefreshStatus, (): void => {
    it("records a success, clearing any earlier failure", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        await redisRefreshStatus(redis).recordSuccess(AT);

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus", {
            lastRefreshAt: "2026-04-21T12:30:05.000Z",
            lastRefreshOutcome: "succeeded",
            lastSuccessAt: "2026-04-21T12:30:05.000Z",
        });
        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("RefreshStatus", ["lastRefreshFailure"]);
    });

    it("records a failure, keeping the last success", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisRefreshStatus(redis).recordFailure(AT, "Reddit is down");

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus", {
            lastRefreshAt: "2026-04-21T12:30:05.000Z",
            lastRefreshOutcome: "failed",
            lastRefreshFailure: "Reddit is down",
        });
    });

    it("records when the next refresh is due, or that none is scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        const refreshStatus = redisRefreshStatus(redis);
        await refreshStatus.recordNextRefresh(AT);
        await refreshStatus.recordNextRefresh(undefined);

        expect(redis.hSet).toHaveBeenCalledExactlyOnceWith("RefreshStatus", {
            nextRefreshAt: "2026-04-21T12:30:05.000Z",
        });
        expect(redis.hDel).toHaveBeenCalledExactlyOnceWith("RefreshStatus", ["nextRefreshAt"]);
    });
});

describe("redisRefreshStatus().read", (): void => {
    it("reads an empty status before the first refresh", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();

        await expect(redisRefreshStatus(redis).read()).resolves.toStrictEqual({
            lastRefresh: undefined,
            lastSuccessAt: undefined,
            nextRefreshAt: undefined,
        });
    });

    it("reads a failed refresh with its failure", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        redis.hGetAll.mockResolvedValue({
            lastRefreshAt: "2026-04-21T12:30:05.000Z",
            lastRefreshOutcome: "failed",
            lastRefreshFailure: "Reddit is down",
            lastSuccessAt: "2026-04-20T12:30:05.000Z",
            nextRefreshAt: "2026-04-21T12:30:05.000Z",
        });

        await expect(redisRefreshStatus(redis).read()).resolves.toStrictEqual({
            lastRefresh: { at: AT, outcome: "failed", failure: "Reddit is down" },
            lastSuccessAt: new Date("2026-04-20T12:30:05.000Z"),
            nextRefreshAt: AT,
        });
        expect(redis.hGetAll).toHaveBeenCalledExactlyOnceWith("RefreshStatus");
    });

    it("ignores fields it cannot read", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        redis.hGetAll.mockResolvedValue({
            lastRefreshAt: "2026-04-21T12:30:05.000Z",
            lastRefreshOutcome: "unknown",
            nextRefreshAt: "not a date",
        });

        await expect(redisRefreshStatus(redis).read()).resolves.toStrictEqual({
            lastRefresh: undefined,
            lastSuccessAt: undefined,
            nextRefreshAt: undefined,
        });
    });
});
