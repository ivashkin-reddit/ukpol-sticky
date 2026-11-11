import { describe, expect, it, vi } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import type { FakeRedis } from "../../../tests/support/fakeDevvitContext.js";
import type { Change } from "../domain/changeRules.js";
import { redisChangeHistory } from "./redisChangeHistory.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CHANGE: Change = {
    kind: "pin",
    at: new Date("2026-11-11T22:31:00Z"),
    moderator: "mod_user",
    action: "pinned",
    post: { id: "t3_ama", title: "AMA with someone" },
    fromSlot: undefined,
    toSlot: 2,
    label: "Event",
    unpinned: { id: "t3_f", title: "Probe 6" },
};

const STORED_CHANGE = JSON.stringify({ ...CHANGE, at: "2026-11-11T22:31:00.000Z" });

function redisHolding(members: readonly string[]): FakeRedis {
    const { redis } = createFakeDevvitContext();
    redis.zRange.mockResolvedValue(
        members.map((member: string): { member: string; score: number } => ({ member, score: 0 })),
    );
    return redis;
}

describe("redisChangeHistory().add", (): void => {
    it(
        "adds the change scored by its time, then drops changes past 90 days and beyond the last 50",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { redis } = createFakeDevvitContext();

            await redisChangeHistory(redis).add(CHANGE);

            expect(redis.zAdd).toHaveBeenCalledExactlyOnceWith("ChangeHistory", {
                member: STORED_CHANGE,
                score: CHANGE.at.getTime(),
            });
            expect(redis.zRemRangeByScore).toHaveBeenCalledExactlyOnceWith(
                "ChangeHistory",
                0,
                new Date("2026-08-13T22:31:00Z").getTime() - 1,
            );
            expect(redis.zRemRangeByRank).toHaveBeenCalledExactlyOnceWith("ChangeHistory", 0, -51);
        },
    );
});

describe("redisChangeHistory().all", (): void => {
    it("reads every stored change back as it was added", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const redis = redisHolding([STORED_CHANGE]);

        await expect(redisChangeHistory(redis).all()).resolves.toStrictEqual([CHANGE]);
        expect(redis.zRange).toHaveBeenCalledExactlyOnceWith("ChangeHistory", 0, -1, { by: "rank" });
    });

    it("reads a change with no label, slots or unpinned post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const unpin: Change = {
            ...CHANGE,
            action: "unpinned",
            fromSlot: 2,
            toSlot: undefined,
            label: undefined,
            unpinned: undefined,
        };
        const redis = redisHolding([JSON.stringify({ ...unpin, at: "2026-11-11T22:31:00.000Z" })]);

        await expect(redisChangeHistory(redis).all()).resolves.toStrictEqual([unpin]);
    });

    it.for([
        "not json",
        "{}",
        "[]",
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), kind: "edit" }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), action: "flipped" }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), post: { id: "t3_ama" } }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), unpinned: "t3_f" }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), toSlot: "2" }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), label: 1 }),
        JSON.stringify({ ...CHANGE, at: 1 }),
        JSON.stringify({ ...CHANGE, at: CHANGE.at.toISOString(), moderator: undefined }),
    ])(
        "skips and logs the unreadable entry %s, keeping the rest",
        TEST_OPTIONS,
        async (member: string): Promise<void> => {
            expect.assertions(2);

            const warn = vi.spyOn(console, "warn").mockImplementation((): undefined => undefined);
            const redis = redisHolding([member, STORED_CHANGE]);

            await expect(redisChangeHistory(redis).all()).resolves.toStrictEqual([CHANGE]);
            expect(warn).toHaveBeenCalledExactlyOnceWith(
                `Skipped a change history entry that cannot be read: ${member.slice(0, 200)}`,
            );
        },
    );
});
