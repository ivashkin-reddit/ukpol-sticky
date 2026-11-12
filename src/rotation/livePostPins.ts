import { getPin, markdownLink } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { placePost, unpinPost } from "../highlights/index.js";
import type { Highlight } from "../highlights/index.js";
import { LAST_SLOT, pinChange } from "./domain/pinRules.js";
import type { ManagedPost, RotationPorts } from "./ports.js";

// A managed thread's live post in the highlights: placed in its slot with the Megathread label, moved when its thread
// config's pin setting changes, and moderators told when Reddit unpinned a post to make room.

export type PinPorts = Pick<RotationPorts, "highlights" | "notifyModerators" | "posts">;
export type PinChangePorts = PinPorts & Pick<RotationPorts, "appliedThreadConfigs">;

/** A thread config's live post, and the slot it goes in. */
export interface LivePostPlacement {
    readonly config: ThreadConfig;
    readonly post: ManagedPost;
    readonly slot: number;
}

// Modmail renders a link on every client when it is absolute.
const REDDIT_ORIGIN = "https://www.reddit.com";

function linkTo(post: ManagedPost): string {
    return markdownLink({ title: post.title, permalink: `${REDDIT_ORIGIN}${post.permalink}` });
}

/** Tells moderators which post Reddit unpinned to make room for the thread config's live post. */
async function alertUnpinned(placing: LivePostPlacement, unpinnedId: string, ports: PinPorts): Promise<void> {
    const unpinned = await ports.posts.get(unpinnedId);
    const { name } = placing.config;
    await ports.notifyModerators({
        subject: `Sticky Manager unpinned a post to pin thread config ${name}`,
        bodyMarkdown: [
            `Pinning thread config ${name}'s live post ${linkTo(placing.post)} into slot ${String(placing.slot)} needed a seventh highlight, so Reddit unpinned ${linkTo(unpinned)}.`,
            'Pin it again with "Pin to slot" if it should stay.',
        ].join("\n\n"),
    });
}

/** Where the live post was before: not pinned, in another slot, or in this slot already, so only its label changed. */
function describeFrom(fromSlot: number | undefined, toSlot: number): string {
    if (fromSlot === undefined) {
        return "it was not pinned";
    }

    return fromSlot === toSlot
        ? "it was there already; its label is now Megathread"
        : `it was in slot ${String(fromSlot)}`;
}

/**
 * Pins the thread config's live post in its slot with the Megathread label, logging what moved and alerting moderators
 * when Reddit unpinned a post to make room. Safe to repeat: a post already in place changes nothing. True if anything
 * changed.
 */
export async function placeLivePost(placing: LivePostPlacement, ports: PinPorts): Promise<boolean> {
    const { config, post } = placing;
    const placement = await placePost({ postId: post.id, slot: placing.slot, label: "megathread" }, ports.highlights);
    if (!placement.changed) {
        return false;
    }

    const unpinnedNote = placement.unpinned === undefined ? "" : ` Reddit unpinned ${placement.unpinned}.`;
    console.log(
        `Placed live post ${post.id} of thread config ${config.name} in slot ${String(placement.toSlot)} (${describeFrom(placement.fromSlot, placement.toSlot)}).${unpinnedNote}`,
    );
    if (placement.unpinned !== undefined) {
        await alertUnpinned({ ...placing, slot: placement.toSlot }, placement.unpinned, ports);
    }

    return true;
}

/** Pins the live post last, unless it is pinned already; true if it was pinned. */
async function pinUnlessPinned(post: ManagedPost, config: ThreadConfig, ports: PinPorts): Promise<boolean> {
    const pinned = (await ports.highlights.list()).some((entry: Highlight): boolean => entry.postId === post.id);
    return pinned ? false : await placeLivePost({ config, post, slot: LAST_SLOT }, ports);
}

/** Unpins the live post if it is pinned; true if it was. */
async function unpinLivePost(post: ManagedPost, config: ThreadConfig, ports: PinPorts): Promise<boolean> {
    const slot = await unpinPost(post.id, ports.highlights);
    if (slot === undefined) {
        return false;
    }

    console.log(`Unpinned live post ${post.id} of thread config ${config.name} from slot ${String(slot)}.`);
    return true;
}

/**
 * Moves the live post when its thread config's `slot` or `sticky` changed since its last refresh, which applied the
 * version recorded then: into a new slot, last when newly sticky, or out of the highlights when no longer pinned.
 * Otherwise the highlights are left as moderators arranged them. True if the live post moved.
 */
export async function applyPinChange(post: ManagedPost, config: ThreadConfig, ports: PinChangePorts): Promise<boolean> {
    const applied = await ports.appliedThreadConfigs.read(config.name);
    const update = pinChange(applied === undefined ? undefined : getPin(applied), getPin(config));
    switch (update.kind) {
        case "none":
            return false;
        case "place":
            return await placeLivePost({ config, post, slot: update.slot }, ports);
        case "pinIfUnpinned":
            return await pinUnlessPinned(post, config, ports);
        case "unpin":
            return await unpinLivePost(post, config, ports);
    }
}
