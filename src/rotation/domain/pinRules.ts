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
