import { addHours } from "date-fns";
import type { Schedule, ThreadConfig } from "../../configuration/index.js";

// A daily live post runs until the first post time at least this many hours after it was created, so one created
// shortly before its post time (by a comment-cap rotation, say) is not rotated again almost at once.
const MIN_HOURS_BEFORE_DAILY_ROTATION = 6;
const DAYS_PER_WEEK = 7;

/** When a live post created at `postDate` is due for rotation under `schedule`. */
export function getRotationTime(postDate: Date, schedule: Schedule): Date {
    const atPostTime = (dayOffset: number): Date =>
        new Date(
            Date.UTC(
                postDate.getUTCFullYear(),
                postDate.getUTCMonth(),
                postDate.getUTCDate() + dayOffset,
                schedule.hours,
                schedule.minutes,
            ),
        );

    if (schedule.kind === "daily") {
        // Counted from the next post time after creation, which may fall on the next UTC day.
        const nextDay = atPostTime(0).getTime() > postDate.getTime() ? 0 : 1;
        const tooSoon = atPostTime(nextDay).getTime() < addHours(postDate, MIN_HOURS_BEFORE_DAILY_ROTATION).getTime();
        return atPostTime(tooSoon ? nextDay + 1 : nextDay);
    }

    const daysUntil = (schedule.weekday - postDate.getUTCDay() + DAYS_PER_WEEK) % DAYS_PER_WEEK;
    // A weekly live post created on its own weekday runs until that weekday next week.
    return atPostTime(daysUntil === 0 ? DAYS_PER_WEEK : daysUntil);
}

export interface LivePostState {
    readonly createdAt: Date;
    readonly numberOfComments: number;
}

/** What makes a thread config's live post due for rotation: its schedule, if it has one, and its comment cap. */
export interface RotationTriggers {
    readonly schedule: Schedule | undefined;
    readonly commentCap: number;
}

/** Why a live post is due for rotation. */
export type RotationReason =
    Readonly<{ kind: "comment cap"; commentCap: number }> | Readonly<{ kind: "rotation time"; rotationTime: Date }>;

/**
 * Why a live post is due for rotation at `now`: its rotation time has passed, or else it has reached its comment cap.
 * Undefined while it is not due.
 */
export function findRotationReason(
    post: LivePostState,
    rotatesOn: RotationTriggers,
    now: number,
): RotationReason | undefined {
    const { schedule } = rotatesOn;
    const rotationTime = schedule === undefined ? undefined : getRotationTime(post.createdAt, schedule);
    if (rotationTime !== undefined && rotationTime.getTime() < now) {
        return { kind: "rotation time", rotationTime };
    }

    return post.numberOfComments >= rotatesOn.commentCap
        ? { kind: "comment cap", commentCap: rotatesOn.commentCap }
        : undefined;
}

/**
 * Whether a post is surely below its comment cap, going by the count a comment's event reports. The count may leave
 * out the new comment, so one comment of margin; 0 means the event did not say, since a post that has just been
 * commented on has at least one.
 */
export function isClearlyBelowCommentCap(reportedComments: number, commentCap: number): boolean {
    return reportedComments > 0 && reportedComments + 1 < commentCap;
}

/**
 * The thread configs a refresh visits, in order: enabled ones only, those `isPinned` says are pinned first, otherwise
 * in config page order.
 */
export function refreshOrder(
    configs: readonly ThreadConfig[],
    isPinned: (config: ThreadConfig) => boolean,
): readonly ThreadConfig[] {
    // Array.prototype.sort is stable, so each group keeps its config page order.
    return configs
        .filter((config): boolean => config.enabled)
        .sort((first, second): number => Number(isPinned(second)) - Number(isPinned(first)));
}

export function earliest(dates: readonly (Date | undefined)[]): Date | undefined {
    return dates
        .filter((date): date is Date => date !== undefined)
        .sort((first, second): number => first.getTime() - second.getTime())[0];
}
