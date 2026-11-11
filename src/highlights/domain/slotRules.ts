// The highlights as Reddit keeps them (probed on r/ukpol_megabot_dev, 2026-11-11): one ordered list of up to six
// pinned posts. Pinning a post puts it first; past six, Reddit drops the last. old.reddit shows the first two as its
// stickies.

export const MAX_HIGHLIGHTS = 6;
/** Slots 1 and 2: the two stickies old.reddit shows. */
export const OLD_REDDIT_SLOTS = 2;

/** The post's slot in `order`, counting from 1; undefined when it is not pinned. */
export function slotOf(order: readonly string[], postId: string): number | undefined {
    const index = order.indexOf(postId);
    return index === -1 ? undefined : index + 1;
}

/** `order` with `postId` in `slot`: first below 1, last past the end; every other post keeps its relative order. */
export function placeInSlot(order: readonly string[], postId: string, slot: number): string[] {
    const others = order.filter((id: string): boolean => id !== postId);
    const index = Math.min(Math.max(slot, 1), others.length + 1) - 1;
    return [...others.slice(0, index), postId, ...others.slice(index)];
}

/** The post Reddit unpins when `postId` is pinned: the last, when all six are taken and `postId` is not one of them. */
export function wouldUnpin(order: readonly string[], postId: string): string | undefined {
    return order.length >= MAX_HIGHLIGHTS && !order.includes(postId) ? order.at(-1) : undefined;
}

export function sameOrder(first: readonly string[], second: readonly string[]): boolean {
    return first.length === second.length && first.every((id: string, index: number): boolean => second[index] === id);
}
