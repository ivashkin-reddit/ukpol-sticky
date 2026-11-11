// Highlights: the subreddit's pinned posts, for any post. It places a post in a slot (one pin, one reorder) and
// unpins posts. Its use cases take the ports in ports.ts; src/composition.ts wires the adapter, and rotation supplies
// the lock of a managed thread.

export { HIGHLIGHT_LABELS, isHighlightLabel, labelName } from "./domain/labels.js";
export type { HighlightLabel } from "./domain/labels.js";
export { MAX_HIGHLIGHTS, OLD_REDDIT_SLOTS, slotOf } from "./domain/slotRules.js";
export { placePost, unpinPost } from "./placement.js";
export type { Placement, PlaceTarget } from "./placement.js";
export type { Highlight, Highlights, HighlightsPorts, ManagedPostLock } from "./ports.js";
