import { describe, expect, it } from "vitest";
import { findCheckFinding, findNextRefresh, isDueAtOnce, isDueWithinRetryDelay, isOnTime } from "./refreshRules.js";
import type { ThreadCheckState, ThreadRefreshState } from "./refreshRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-04-21T10:00:00Z");

/** A thread config whose stored version is applied, with a live post due at 12:30 and nothing failed or unfinished. */
const SETTLED: ThreadRefreshState = {
    applied: true,
    failed: false,
    hasLivePost: true,
    hasUnfinishedHandover: false,
    rotationTime: new Date("2026-04-21T12:30:00Z"),
};

describe(findNextRefresh, (): void => {
    it("schedules the refresh five seconds after the rotation time", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findNextRefresh(SETTLED, NOW)).toStrictEqual({
            at: new Date("2026-04-21T12:30:05Z"),
            reason: "to rotate it",
        });
    });

    it("schedules an overdue rotation five seconds from now, never in the past", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findNextRefresh({ ...SETTLED, rotationTime: new Date("2026-04-21T04:00:00Z") }, NOW)).toStrictEqual({
            at: new Date("2026-04-21T10:00:05Z"),
            reason: "to rotate it",
        });
    });

    it("needs no refresh for a thread config with a live post and no schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findNextRefresh({ ...SETTLED, rotationTime: undefined }, NOW)).toBeUndefined();
    });

    it.for<readonly [Partial<ThreadRefreshState>, string]>([
        [{ applied: false }, "to apply its stored thread config"],
        [{ hasLivePost: false, rotationTime: undefined }, "to publish its live post"],
        [{ hasUnfinishedHandover: true }, "to finish its handover"],
    ])("schedules a refresh at once when %j", TEST_OPTIONS, ([change, reason]): void => {
        expect.assertions(1);

        expect(findNextRefresh({ ...SETTLED, ...change }, NOW)).toStrictEqual({
            at: new Date("2026-04-21T10:00:05Z"),
            reason,
        });
    });

    it("retries a failure fifteen minutes on, leaving an overdue rotation time out", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const failedWhileOverdue = { ...SETTLED, failed: true, rotationTime: new Date("2026-04-21T09:30:00Z") };

        expect(findNextRefresh(failedWhileOverdue, NOW)).toStrictEqual({
            at: new Date("2026-04-21T10:15:05Z"),
            reason: "to retry it after a failure",
        });
    });

    it("retries a failure before publishing a missing live post or finishing a handover", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const failedPublish = { ...SETTLED, failed: true, hasLivePost: false, hasUnfinishedHandover: true };

        expect(findNextRefresh(failedPublish, NOW)?.reason).toBe("to retry it after a failure");
    });

    it(
        "applies a stored version at once even after a failure, so the retry cannot replace the save's refresh",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            expect(findNextRefresh({ ...SETTLED, applied: false, failed: true }, NOW)).toStrictEqual({
                at: new Date("2026-04-21T10:00:05Z"),
                reason: "to apply its stored thread config",
            });
        },
    );
});

describe("whether a pending refresh comes in time", (): void => {
    it.for<readonly [string, boolean]>([
        ["2026-04-21T09:50:01Z", true],
        ["2026-04-21T09:50:00Z", false],
    ])("takes a refresh due %s as on time: %s", TEST_OPTIONS, ([runAt, onTime]): void => {
        expect.assertions(1);

        expect(isOnTime(new Date(runAt), NOW)).toBe(onTime);
    });

    it.for<readonly [string, boolean]>([
        ["2026-04-21T10:00:05Z", true],
        ["2026-04-21T10:00:06Z", false],
        ["2026-04-21T09:45:00Z", false],
    ])("takes a refresh due %s as due at once: %s", TEST_OPTIONS, ([runAt, dueAtOnce]): void => {
        expect.assertions(1);

        expect(isDueAtOnce(new Date(runAt), NOW)).toBe(dueAtOnce);
    });

    it.for<readonly [string, boolean]>([
        ["2026-04-21T10:15:05Z", true],
        ["2026-04-21T10:15:06Z", false],
        ["2026-04-21T09:45:00Z", false],
    ])("takes a refresh due %s as due within the retry delay: %s", TEST_OPTIONS, ([runAt, soon]): void => {
        expect.assertions(1);

        expect(isDueWithinRetryDelay(new Date(runAt), NOW)).toBe(soon);
    });
});

/** A thread config in force with a schedule, a live post, its stored version applied, and its 12:30 refresh pending. */
const ON_TRACK: ThreadCheckState = {
    applied: true,
    hasLivePost: true,
    hasUnfinishedHandover: false,
    hasSchedule: true,
    pendingRunTimes: [new Date("2026-04-21T12:30:05Z")],
};

describe(findCheckFinding, (): void => {
    it("finds nothing for a thread config whose refresh is pending and on time", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findCheckFinding(ON_TRACK, NOW)).toBeUndefined();
    });

    it("finds a missing refresh for a thread config with a schedule and none pending", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findCheckFinding({ ...ON_TRACK, pendingRunTimes: [] }, NOW)).toStrictEqual({ kind: "missing" });
    });

    it("needs nothing pending for a thread config with a live post and no schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findCheckFinding({ ...ON_TRACK, hasSchedule: false, pendingRunTimes: [] }, NOW)).toBeUndefined();
    });

    it("finds a refresh more than ten minutes past its time stuck, before anything else", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const stuck = { ...ON_TRACK, applied: false, pendingRunTimes: [new Date("2026-04-21T09:45:00Z")] };

        expect(findCheckFinding(stuck, NOW)).toStrictEqual({
            kind: "stuck",
            stuckAt: new Date("2026-04-21T09:45:00Z"),
        });
    });

    it.for<readonly [Partial<ThreadCheckState>, string]>([
        [{ applied: false }, "unapplied"],
        [{ hasLivePost: false }, "no live post"],
        [{ hasUnfinishedHandover: true }, "unfinished handover"],
    ])("finds a need now (%j) when no refresh of it is due soon", TEST_OPTIONS, ([change, kind]): void => {
        expect.assertions(1);

        expect(findCheckFinding({ ...ON_TRACK, ...change }, NOW)).toStrictEqual({ kind });
    });

    it("leaves a need now to a refresh of it due within the retry delay", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const retryPending = { ...ON_TRACK, hasLivePost: false, pendingRunTimes: [new Date("2026-04-21T10:12:00Z")] };

        expect(findCheckFinding(retryPending, NOW)).toBeUndefined();
    });
});
