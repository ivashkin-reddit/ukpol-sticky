import { subDays } from "date-fns";

// The change history keeps the moderator changes made through the app: the last 50, none older than 90 days.

export const KEPT_CHANGES = 50;
export const KEPT_DAYS = 90;
/** Reddit's limit on a post title: a change keeps no more of one. */
const MAX_TITLE = 300;

/** A post as a change names it: its ID, and its title when the change was made. */
export interface PostRef {
    readonly id: string;
    readonly title: string;
}

export type PinAction = "moved" | "pinned" | "relabelled" | "unpinned";

/** A moderator's "Pin to slot" that changed the highlights. */
export interface PinChange {
    readonly kind: "pin";
    readonly at: Date;
    readonly moderator: string;
    readonly action: PinAction;
    readonly post: PostRef;
    /** Undefined when the post was not pinned. */
    readonly fromSlot: number | undefined;
    /** Undefined when the post was unpinned. */
    readonly toSlot: number | undefined;
    /** The label's name as moderators see it, such as "Megathread"; undefined for none. */
    readonly label: string | undefined;
    /** The post Reddit unpinned to make room, if any. */
    readonly unpinned: PostRef | undefined;
}

/** A moderator change made through the app. Sub-projects 5 and 6 add kinds. */
export type Change = PinChange;

/** The earliest time a kept change can have, as of `now`. */
export function oldestKept(now: Date): Date {
    return subDays(now, KEPT_DAYS);
}

/** `changes`' latest `count` still kept as of `now`, newest first. */
export function latestKept(changes: readonly Change[], now: Date, count: number): Change[] {
    const cutoff = oldestKept(now).getTime();
    return changes
        .filter((change: Change): boolean => change.at.getTime() >= cutoff)
        .toSorted((first: Change, second: Change): number => second.at.getTime() - first.at.getTime())
        .slice(0, Math.min(count, KEPT_CHANGES));
}

/** A title as a change keeps it: whole up to Reddit's 300 characters, cut with an ellipsis beyond. */
export function keptTitle(title: string): string {
    return title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;
}
