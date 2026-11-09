import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { redisRetiredRefreshRecords } from "./redisRetiredRefreshRecords.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(redisRetiredRefreshRecords, (): void => {
    it("reads the record of applied thread configs from its old key", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { redis } = createFakeDevvitContext();
        redis.get.mockResolvedValue("[]");

        await expect(redisRetiredRefreshRecords(redis).readAppliedThreadConfigs()).resolves.toBe("[]");
        expect(redis.get).toHaveBeenCalledExactlyOnceWith("AppliedThreadConfigs");
    });

    it("deletes both old keys", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { redis } = createFakeDevvitContext();
        await redisRetiredRefreshRecords(redis).delete();

        expect(redis.del).toHaveBeenCalledExactlyOnceWith("AppliedThreadConfigs", "RefreshStatus");
    });
});
