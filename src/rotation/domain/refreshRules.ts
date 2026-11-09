import { addMinutes, addSeconds, subMinutes } from "date-fns";

// A refresh scheduled for a time runs a few seconds after it, so whatever is due is due by then.
const REFRESH_JOB_DELAY_SECONDS = 5;
// How soon a thread config whose refresh failed is retried.
const RETRY_DELAY_MINUTES = 15;
// A pending refresh this long past its time is taken as stuck: Devvit runs a job within about a minute of its time.
const STUCK_AFTER_MINUTES = 10;

/** Why a thread config's next refresh is scheduled, as its log line ends. */
export type RefreshReason =
    | "to apply its stored thread config"
    | "to finish its handover"
    | "to publish its live post"
    | "to retry it after a failure"
    | "to rotate it";

/** What the next-refresh rule reads of a thread config. */
export interface ThreadRefreshState {
    /** Whether its stored version is the one its last refresh applied. */
    readonly applied: boolean;
    /** Whether its refresh has just failed. */
    readonly failed: boolean;
    readonly hasLivePost: boolean;
    readonly hasUnfinishedHandover: boolean;
    /** When its live post is due for rotation; undefined when it has no live post or its thread config no schedule. */
    readonly rotationTime: Date | undefined;
}

/** When a thread config's next refresh runs, and why. */
export interface NextRefresh {
    readonly at: Date;
    readonly reason: RefreshReason;
}

/** When a refresh due at `dueAt` runs as of `now`: a few seconds after it, and never in the past. */
function runTime(dueAt: Date, now: Date): Date {
    return addSeconds(new Date(Math.max(dueAt.getTime(), now.getTime())), REFRESH_JOB_DELAY_SECONDS);
}

/**
 * When a thread config's next refresh is due, and why; undefined when it needs none. The first case that applies
 * decides. A stored version not yet applied comes first, even after a failure, or the failed refresh's retry would
 * replace the refresh a save requested; it cannot repeat, since the retry records the version it used as applied. A
 * failure then waits the retry delay, leaving the rotation time out, so a thread config that keeps failing while
 * overdue is not refreshed every few seconds.
 */
export function findNextRefresh(state: ThreadRefreshState, now: Date): NextRefresh | undefined {
    if (!state.applied) {
        return { at: runTime(now, now), reason: "to apply its stored thread config" };
    }

    if (state.failed) {
        return { at: runTime(addMinutes(now, RETRY_DELAY_MINUTES), now), reason: "to retry it after a failure" };
    }

    if (!state.hasLivePost) {
        return { at: runTime(now, now), reason: "to publish its live post" };
    }

    if (state.hasUnfinishedHandover) {
        return { at: runTime(now, now), reason: "to finish its handover" };
    }

    return state.rotationTime === undefined
        ? undefined
        : { at: runTime(state.rotationTime, now), reason: "to rotate it" };
}

/** Whether a refresh due at `runAt` can still be expected to run as of `now`: it is not long past its time. */
export function isOnTime(runAt: Date, now: Date): boolean {
    return runAt.getTime() > subMinutes(now, STUCK_AFTER_MINUTES).getTime();
}

/** Whether a refresh due at `runAt` runs at once as of `now`: on time, and no later than one requested now. */
export function isDueAtOnce(runAt: Date, now: Date): boolean {
    return isOnTime(runAt, now) && runAt.getTime() <= runTime(now, now).getTime();
}

/** Whether a refresh due at `runAt` runs within the retry delay as of `now`, as a retry scheduled now would. */
export function isDueWithinRetryDelay(runAt: Date, now: Date): boolean {
    return isOnTime(runAt, now) && runAt.getTime() <= runTime(addMinutes(now, RETRY_DELAY_MINUTES), now).getTime();
}

/**
 * Whether a refresh due at `runAt` is a retry still to come as of `now`: due later than now, and within the retry
 * delay. One whose time has come does not count: the scheduler lists a job until it has run, so after a failure it may
 * be the failed refresh's own job.
 */
export function isRetryToCome(runAt: Date, now: Date): boolean {
    return runAt.getTime() > now.getTime() && isDueWithinRetryDelay(runAt, now);
}

/** What the refresh check reads of a thread config in force. */
export interface ThreadCheckState {
    readonly applied: boolean;
    readonly hasLivePost: boolean;
    readonly hasUnfinishedHandover: boolean;
    /** Whether its thread config has a schedule. */
    readonly hasSchedule: boolean;
    /** When each of its pending refreshes is due. */
    readonly pendingRunTimes: readonly Date[];
}

/** Why the refresh check requests a thread config's refresh. */
export type CheckFinding =
    | Readonly<{ kind: "missing" }>
    | Readonly<{ kind: "no live post" }>
    | Readonly<{ kind: "stuck"; stuckAt: Date }>
    | Readonly<{ kind: "unapplied" }>
    | Readonly<{ kind: "unfinished handover" }>;

/** What makes a thread config need a refresh now, if anything does. */
function findNeedNow(state: ThreadCheckState): CheckFinding | undefined {
    if (!state.applied) {
        return { kind: "unapplied" };
    }

    if (!state.hasLivePost) {
        return { kind: "no live post" };
    }

    return state.hasUnfinishedHandover ? { kind: "unfinished handover" } : undefined;
}

/**
 * Whether the refresh check must request a thread config's refresh, and why; undefined when it need not. A pending
 * refresh long past its time is stuck and is replaced. A thread config that needs a refresh now gets one unless a
 * refresh of it is due within the retry delay, so a pending retry is left alone; one with a schedule gets one when no
 * refresh of it is pending.
 */
export function findCheckFinding(state: ThreadCheckState, now: Date): CheckFinding | undefined {
    const stuckAt = state.pendingRunTimes.find((runAt: Date): boolean => !isOnTime(runAt, now));
    if (stuckAt !== undefined) {
        return { kind: "stuck", stuckAt };
    }

    const needNow = findNeedNow(state);
    if (needNow !== undefined) {
        const retryPending = state.pendingRunTimes.some((runAt: Date): boolean => isDueWithinRetryDelay(runAt, now));
        return retryPending ? undefined : needNow;
    }

    return state.hasSchedule && state.pendingRunTimes.length === 0 ? { kind: "missing" } : undefined;
}
