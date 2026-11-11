import type { Pin } from "../../configuration/index.js";

// Where a rotation pins its new live post.

/** "Last": a slot past the end of the highlights is placed last, and Reddit holds no more than six. */
export const LAST_SLOT = 6;

/**
 * The slot a rotation's new live post takes: its thread config's slot; else, with `sticky: true` alone, the slot the
 * old post held, or last; undefined when the thread config is not pinned.
 */
export function rotationSlot(pin: Pin, oldSlot: number | undefined): number | undefined {
    switch (pin.kind) {
        case "slot":
            return pin.slot;
        case "keepSlot":
            return oldSlot ?? LAST_SLOT;
        case "none":
            return undefined;
    }
}

/** What a change to a thread config's `slot` or `sticky` does to its live post. */
export type PinUpdate =
    | Readonly<{ kind: "none" }>
    | Readonly<{ kind: "pinIfUnpinned" }>
    | Readonly<{ kind: "place"; slot: number }>
    | Readonly<{ kind: "unpin" }>;

const NO_UPDATE: PinUpdate = { kind: "none" };

/**
 * Between the version a thread config's last refresh applied and the one now in force: a new or changed slot places
 * the live post there; newly sticky without a slot pins it last unless it is pinned; no longer pinned unpins it; a slot
 * removed while sticky stays leaves it where it is. With no applied version there is nothing to compare.
 */
export function pinChange(applied: Pin | undefined, current: Pin): PinUpdate {
    if (applied === undefined) {
        return NO_UPDATE;
    }

    switch (current.kind) {
        case "slot":
            return applied.kind === "slot" && applied.slot === current.slot
                ? NO_UPDATE
                : { kind: "place", slot: current.slot };
        case "keepSlot":
            return applied.kind === "none" ? { kind: "pinIfUnpinned" } : NO_UPDATE;
        case "none":
            return applied.kind === "none" ? NO_UPDATE : { kind: "unpin" };
    }
}
