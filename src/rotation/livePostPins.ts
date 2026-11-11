import { markdownLink } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { placePost } from "../highlights/index.js";
import type { ManagedPost, RotationPorts } from "./ports.js";

// A managed thread's live post in the highlights: placed in its slot with the Megathread label, and moderators told
// when Reddit unpinned a post to make room.

export type PinPorts = Pick<RotationPorts, "highlights" | "notifyModerators" | "posts">;

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

function describeFrom(fromSlot: number | undefined): string {
    return fromSlot === undefined ? "it was not pinned" : `it was in slot ${String(fromSlot)}`;
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
        `Placed live post ${post.id} of thread config ${config.name} in slot ${String(placement.toSlot)} (${describeFrom(placement.fromSlot)}).${unpinnedNote}`,
    );
    if (placement.unpinned !== undefined) {
        await alertUnpinned({ ...placing, slot: placement.toSlot }, placement.unpinned, ports);
    }

    return true;
}
