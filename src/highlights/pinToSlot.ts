import { keptTitle } from "../changes/index.js";
import type { PinAction, PinChange, PostRef } from "../changes/index.js";
import { labelName } from "./domain/labels.js";
import type { HighlightLabel } from "./domain/labels.js";
import { wouldUnpin } from "./domain/slotRules.js";
import { placePost, unpinPost } from "./placement.js";
import type { Placement } from "./placement.js";
import type { Highlight, Highlights, HighlightsPorts } from "./ports.js";

/** A moderator's "Pin to slot", its post already checked to be this subreddit's. */
export interface PinRequest {
    readonly moderator: string;
    readonly post: PostRef;
    /** Undefined: "Not pinned". */
    readonly slot: number | undefined;
    readonly label: HighlightLabel | undefined;
    /** The post the moderator agreed to have unpinned when all six were taken; undefined if none. */
    readonly confirmedUnpin: string | undefined;
}

export type PinOutcome =
    | Readonly<{ kind: "busy" }>
    | Readonly<{ kind: "changed"; change: PinChange }>
    | Readonly<{ kind: "confirm"; wouldUnpin: PostRef }>
    | Readonly<{ kind: "unchanged" }>;

/** One highlight as the pin form shows it. */
export type HighlightEntry = Readonly<{ post: PostRef; label: HighlightLabel | undefined }>;

/** The highlights as the pin form shows them, and the post pinning the form's post would unpin. */
export interface HighlightsView {
    readonly entries: readonly HighlightEntry[];
    readonly wouldUnpin: PostRef | undefined;
}

/** What every pin change records: what kind, when, by whom, and of which post. */
type ChangeHead = Pick<PinChange, "at" | "kind" | "moderator" | "post">;

function postIds(highlights: readonly Highlight[]): string[] {
    return highlights.map((entry: Highlight): string => entry.postId);
}

/** A post's ID and kept title; its ID stands in for a title Reddit cannot give, as for a deleted post. */
async function readRef(postId: string, highlights: Highlights): Promise<PostRef> {
    const post = await highlights.readPost(postId);
    return { id: postId, title: keptTitle(post?.title ?? postId) };
}

function actionOf(placement: Placement): PinAction {
    if (placement.fromSlot === undefined) {
        return "pinned";
    }

    return placement.fromSlot === placement.toSlot ? "relabelled" : "moved";
}

async function unpin(request: PinRequest, head: ChangeHead, highlights: Highlights): Promise<PinChange | undefined> {
    const fromSlot = await unpinPost(request.post.id, highlights);
    return fromSlot === undefined
        ? undefined
        : { ...head, action: "unpinned", fromSlot, toSlot: undefined, label: undefined, unpinned: undefined };
}

/** Carries out the request; the change it made, or undefined when it changed nothing. */
async function applyPin(request: PinRequest, highlights: Highlights): Promise<PinChange | undefined> {
    const head: ChangeHead = {
        kind: "pin",
        at: new Date(),
        moderator: request.moderator,
        post: { id: request.post.id, title: keptTitle(request.post.title) },
    };
    if (request.slot === undefined) {
        return await unpin(request, head, highlights);
    }

    const placement = await placePost(
        { postId: request.post.id, slot: request.slot, label: request.label },
        highlights,
    );
    if (!placement.changed) {
        return undefined;
    }

    return {
        ...head,
        action: actionOf(placement),
        fromSlot: placement.fromSlot,
        toSlot: placement.toSlot,
        label: labelName(request.label),
        unpinned: placement.unpinned === undefined ? undefined : await readRef(placement.unpinned, highlights),
    };
}

/** The post pinning the request's post would unpin, when the moderator has not agreed to it; else undefined. */
async function unconfirmedUnpin(request: PinRequest, highlights: Highlights): Promise<string | undefined> {
    if (request.slot === undefined) {
        return undefined;
    }

    const pending = wouldUnpin(postIds(await highlights.list()), request.post.id);
    return pending === request.confirmedUnpin ? undefined : pending;
}

/**
 * A moderator's "Pin to slot": places the post in its slot with its label, or unpins it, holding the lock of the
 * managed thread whose live post it is. When all six are taken, it goes ahead only if the moderator confirmed the post
 * Reddit would unpin; otherwise it asks. A change is recorded in the change history once made; no change, no record.
 */
export async function pinToSlot(request: PinRequest, ports: HighlightsPorts): Promise<PinOutcome> {
    const pending = await unconfirmedUnpin(request, ports.highlights);
    if (pending !== undefined) {
        return { kind: "confirm", wouldUnpin: await readRef(pending, ports.highlights) };
    }

    const held = await ports.managedPostLock(
        request.post.id,
        async (): Promise<PinChange | undefined> => await applyPin(request, ports.highlights),
    );
    if (held.kind === "busy") {
        return held;
    }

    if (held.result === undefined) {
        return { kind: "unchanged" };
    }

    await ports.changeHistory.add(held.result);
    return { kind: "changed", change: held.result };
}

/** The highlights with titles and labels, and the post pinning `postId` would unpin, for the pin form. */
export async function describeHighlights(postId: string, highlights: Highlights): Promise<HighlightsView> {
    const list = await highlights.list();
    const entries = await Promise.all(
        list.map(async (entry: Highlight): Promise<HighlightEntry> => ({
            post: await readRef(entry.postId, highlights),
            label: entry.label,
        })),
    );
    const pending = wouldUnpin(postIds(list), postId);
    return { entries, wouldUnpin: entries.find((entry: HighlightEntry): boolean => entry.post.id === pending)?.post };
}
