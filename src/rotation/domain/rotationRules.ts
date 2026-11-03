import { addHours } from "date-fns";
import type { Schedule, ThreadConfig } from "../../configuration/index.js";

// A daily live post created less than this many hours before today's post time runs until tomorrow's.
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
        const sameDay = atPostTime(0);
        return sameDay.getTime() < addHours(postDate, MIN_HOURS_BEFORE_DAILY_ROTATION).getTime()
            ? atPostTime(1)
            : sameDay;
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

/** Whether a live post is due for rotation at `now`: its rotation time has passed, or it has reached its comment cap. */
export function isDueForRotation(post: LivePostState, rotatesOn: RotationTriggers, now: number): boolean {
    const { schedule } = rotatesOn;
    const pastRotationTime = schedule !== undefined && getRotationTime(post.createdAt, schedule).getTime() < now;
    return pastRotationTime || post.numberOfComments >= rotatesOn.commentCap;
}

/** The thread configs a refresh visits, in order: enabled ones only, sticky first, otherwise in config page order. */
export function refreshOrder(configs: readonly ThreadConfig[]): readonly ThreadConfig[] {
    // Array.prototype.sort is stable, so each group keeps its config page order.
    return configs
        .filter((config): boolean => config.enabled)
        .sort((first, second): number => Number(second.sticky === true) - Number(first.sticky === true));
}

export function earliest(dates: readonly (Date | undefined)[]): Date | undefined {
    return dates
        .filter((date): date is Date => date !== undefined)
        .sort((first, second): number => first.getTime() - second.getTime())[0];
}
