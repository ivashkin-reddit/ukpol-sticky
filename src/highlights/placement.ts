import type { HighlightLabel } from "./domain/labels.js";
import { placeInSlot, sameOrder, slotOf } from "./domain/slotRules.js";
import type { Highlight, Highlights } from "./ports.js";

/** Where to place a post: its slot, and the label it carries there (undefined for none). */
export type PlaceTarget = Readonly<{ postId: string; slot: number; label: HighlightLabel | undefined }>;

/** What placing a post did. */
export interface Placement {
    /** Its slot before; undefined when it was not pinned. */
    readonly fromSlot: number | undefined;
    readonly toSlot: number;
    /** The post Reddit unpinned to make room, if any. */
    readonly unpinned: string | undefined;
    /** False when the post was already in its slot with its label. */
    readonly changed: boolean;
}

function postIds(highlights: readonly Highlight[]): string[] {
    return highlights.map((entry: Highlight): string => entry.postId);
}

/** Pins the post unless it is pinned with its label; the order afterwards, and whether it pinned. */
async function pinIfNeeded(
    target: PlaceTarget,
    before: readonly Highlight[],
    highlights: Highlights,
): Promise<Readonly<{ order: readonly string[]; pinned: boolean }>> {
    const current = before.find((entry: Highlight): boolean => entry.postId === target.postId);
    if (current !== undefined && current.label === target.label) {
        return { order: postIds(before), pinned: false };
    }

    await highlights.pin(target.postId, target.label);
    return { order: postIds(await highlights.list()), pinned: true };
}

/** Reorders the highlights so the post sits in its slot, unless it already does; the order afterwards. */
async function reorderIfNeeded(
    target: PlaceTarget,
    pinnedOrder: readonly string[],
    highlights: Highlights,
): Promise<Readonly<{ order: readonly string[]; reordered: boolean }>> {
    const order = placeInSlot(pinnedOrder, target.postId, target.slot);
    if (sameOrder(pinnedOrder, order)) {
        return { order, reordered: false };
    }

    await highlights.reorder(order);
    return { order, reordered: true };
}

/**
 * Puts the post in its slot with its label: pins it if it is not pinned or its label differs (Reddit puts a newly
 * pinned post first), then reorders once so it sits in its slot, or last when the slot is past the end, with every
 * other post in its relative order. Safe to repeat: a post already in its slot with its label is left alone.
 */
export async function placePost(target: PlaceTarget, highlights: Highlights): Promise<Placement> {
    const before = await highlights.list();
    const beforeOrder = postIds(before);
    const pinning = await pinIfNeeded(target, before, highlights);
    const reordering = await reorderIfNeeded(target, pinning.order, highlights);
    return {
        fromSlot: slotOf(beforeOrder, target.postId),
        toSlot: reordering.order.indexOf(target.postId) + 1,
        unpinned: beforeOrder.find((id: string): boolean => id !== target.postId && !pinning.order.includes(id)),
        changed: pinning.pinned || reordering.reordered,
    };
}

/** Unpins the post if it is pinned; its slot before, or undefined when it was not pinned. */
export async function unpinPost(postId: string, highlights: Highlights): Promise<number | undefined> {
    const slot = slotOf(postIds(await highlights.list()), postId);
    if (slot !== undefined) {
        await highlights.unpin(postId);
    }

    return slot;
}
