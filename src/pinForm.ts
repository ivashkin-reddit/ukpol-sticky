import type { Form, FormField } from "@devvit/web/shared";
import type { PostRef } from "./changes/index.js";
import { HIGHLIGHT_LABELS, labelName, MAX_HIGHLIGHTS, OLD_REDDIT_SLOTS } from "./highlights/index.js";
import type { HighlightEntry, HighlightLabel, HighlightsView } from "./highlights/index.js";
import type { ManagingThread } from "./rotation/index.js";

// The pin form: which post, the highlights now, and the slot, label and (when all six are taken) the post to give up.
// The post travels in a one-option select, as Devvit forms have no hidden fields; the server checks it again.

/** The pin form's name, as devvit.json declares it. */
export const PIN_FORM_NAME = "pinForm";
export const PIN_FIELDS = {
    post: "post",
    slot: "slot",
    label: "label",
    confirm: "confirmUnpin",
    highlights: "highlights-now",
} as const;
/** The slot choice for "Not pinned", and the label choice for none. */
export const NOT_PINNED = "none";
export const NO_LABEL = "none";
/** The "To make room" choice that pins nothing, leaving the highlights as they are. */
export const KEEP_PINNED = "keep";

const SLOTS_NOTE = "Slots 1 and 2 are old.reddit's two stickies.";

/** What the pin form shows. */
export interface PinView {
    readonly post: PostRef;
    readonly highlights: HighlightsView;
    /** The thread config whose live post the post is; undefined for any other post. */
    readonly managedBy: ManagingThread | undefined;
    /** A line the description opens with, such as why the form is shown again. */
    readonly notice: string | undefined;
}

type Option = Readonly<{ label: string; value: string }>;

function slotName(slot: number): string {
    return slot <= OLD_REDDIT_SLOTS ? `${String(slot)} (old.reddit sticky)` : String(slot);
}

function listHighlights(entries: readonly HighlightEntry[]): string {
    if (entries.length === 0) {
        return "None pinned.";
    }

    return entries
        .map((entry: HighlightEntry, index: number): string => {
            const label = labelName(entry.label) ?? "no label";
            const details = index < OLD_REDDIT_SLOTS ? `${label}, old.reddit sticky` : label;
            return `${String(index + 1)}. "${entry.post.title}" (${details})`;
        })
        .join("\n");
}

function managedNote(managedBy: ManagingThread | undefined): string | undefined {
    if (managedBy === undefined || managedBy.pin.kind === "none") {
        return undefined;
    }

    return managedBy.pin.kind === "slot"
        ? `This is thread config ${managedBy.configName}'s live post; it returns to slot ${String(managedBy.pin.slot)} at its next rotation.`
        : `This is thread config ${managedBy.configName}'s live post; each new live post takes its slot.`;
}

function slotField(view: PinView): FormField {
    const ids = view.highlights.entries.map((entry: HighlightEntry): string => entry.post.id);
    const current = ids.indexOf(view.post.id) + 1;
    const others = ids.filter((id: string): boolean => id !== view.post.id).length;
    const highest = Math.min(others + 1, MAX_HIGHLIGHTS);
    const slots = Array.from({ length: highest }, (_unused: unknown, index: number): number => index + 1);
    return {
        type: "select",
        name: PIN_FIELDS.slot,
        label: "Slot",
        options: [
            ...slots.map((slot: number): Option => ({ label: slotName(slot), value: String(slot) })),
            { label: "Not pinned", value: NOT_PINNED },
        ],
        defaultValue: [String(current === 0 ? highest : current)],
        required: true,
    };
}

function labelField(view: PinView): FormField {
    const current = view.highlights.entries.find((entry: HighlightEntry): boolean => entry.post.id === view.post.id);
    const fallback: HighlightLabel | undefined = view.managedBy === undefined ? undefined : "megathread";
    const chosen = current === undefined ? fallback : current.label;
    return {
        type: "select",
        name: PIN_FIELDS.label,
        label: "Label",
        options: [
            ...HIGHLIGHT_LABELS.map((label: HighlightLabel): Option => ({
                label: labelName(label) ?? label,
                value: label,
            })),
            { label: "None", value: NO_LABEL },
        ],
        defaultValue: [chosen ?? NO_LABEL],
        required: true,
    };
}

/**
 * When all six are taken, a required choice: unpin the post Reddit would drop (its ID, so a changed list asks again),
 * or keep the highlights as they are. Save stays blocked until one is chosen.
 */
function confirmField(wouldUnpin: PostRef | undefined): FormField[] {
    return wouldUnpin === undefined
        ? []
        : [
              {
                  type: "select",
                  name: PIN_FIELDS.confirm,
                  label: "To make room",
                  helpText: `All six highlights are taken: pinning this post unpins "${wouldUnpin.title}".`,
                  options: [
                      { label: `Unpin "${wouldUnpin.title}" to make room`, value: wouldUnpin.id },
                      { label: `Keep "${wouldUnpin.title}" pinned (pin nothing)`, value: KEEP_PINNED },
                  ],
                  required: true,
              },
          ];
}

/** The pin form: the post, the highlights now, then the slot, the label and any confirmation, above Save. */
export function layOutPinForm(view: PinView): Form {
    const description = [view.notice, SLOTS_NOTE, managedNote(view.managedBy)]
        .filter((line: string | undefined): line is string => line !== undefined)
        .join(" ");
    return {
        title: "Pin to slot",
        description,
        fields: [
            {
                type: "select",
                name: PIN_FIELDS.post,
                label: "Post",
                options: [{ label: view.post.title, value: view.post.id }],
                defaultValue: [view.post.id],
                required: true,
            },
            {
                type: "paragraph",
                name: PIN_FIELDS.highlights,
                label: "Highlights now",
                defaultValue: listHighlights(view.highlights.entries),
                disabled: true,
            },
            slotField(view),
            labelField(view),
            ...confirmField(view.highlights.wouldUnpin),
        ],
        acceptLabel: "Save",
        cancelLabel: "Cancel",
    };
}
