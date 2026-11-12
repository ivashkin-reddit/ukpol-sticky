import { describe, expect, it } from "vitest";
import type { HighlightEntry } from "./highlights/index.js";
import { layOutPinForm } from "./pinForm.js";
import type { PinView } from "./pinForm.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const AMA = { id: "t3_ama", title: "AMA" };

function entry(id: string, title: string, label?: HighlightEntry["label"]): HighlightEntry {
    return { post: { id, title }, label };
}

const WEEKLY = entry("t3_weekly", "Weekly", "megathread");
const OTHER = entry("t3_other", "Other");

function view(fields: Partial<PinView> = {}): PinView {
    return {
        post: AMA,
        highlights: { entries: [WEEKLY, OTHER], wouldUnpin: undefined },
        managedBy: undefined,
        notice: undefined,
        ...fields,
    };
}

/** A form field as far as these tests read it. */
type FieldView = Readonly<{ name?: string; label?: string; defaultValue?: unknown; options?: unknown }>;

function field(fields: readonly FieldView[], name: string): FieldView | undefined {
    return fields.find((candidate: FieldView): boolean => candidate.name === name);
}

describe(layOutPinForm, (): void => {
    it("lays out the post, the highlights now, the slot and the label, above Save", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(layOutPinForm(view())).toStrictEqual({
            title: "Pin to slot",
            description: "Slots 1 and 2 are old.reddit's two stickies.",
            fields: [
                {
                    type: "select",
                    name: "post",
                    label: "Post",
                    options: [{ label: "AMA", value: "t3_ama" }],
                    defaultValue: ["t3_ama"],
                    required: true,
                },
                {
                    type: "paragraph",
                    name: "highlights-now",
                    label: "Highlights now",
                    defaultValue:
                        '1. "Weekly" (Megathread, old.reddit sticky)\n2. "Other" (no label, old.reddit sticky)',
                    disabled: true,
                },
                {
                    type: "select",
                    name: "slot",
                    label: "Slot",
                    options: [
                        { label: "1 (old.reddit sticky)", value: "1" },
                        { label: "2 (old.reddit sticky)", value: "2" },
                        { label: "3", value: "3" },
                        { label: "Not pinned", value: "none" },
                    ],
                    defaultValue: ["3"],
                    required: true,
                },
                {
                    type: "select",
                    name: "label",
                    label: "Label",
                    options: [
                        { label: "Megathread", value: "megathread" },
                        { label: "Announcement", value: "announcement" },
                        { label: "Event", value: "event" },
                        { label: "None", value: "none" },
                    ],
                    defaultValue: ["none"],
                    required: true,
                },
            ],
            acceptLabel: "Save",
            cancelLabel: "Cancel",
        });
    });

    it(
        "defaults to the post's own slot and label when it is pinned, offering no slot past the others",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(2);

            const { fields } = layOutPinForm(
                view({ highlights: { entries: [WEEKLY, entry("t3_ama", "AMA", "event")], wouldUnpin: undefined } }),
            );

            expect(field(fields, "slot")).toHaveProperty("defaultValue", ["2"]);
            expect([field(fields, "label"), field(fields, "slot")]).toMatchObject([
                { defaultValue: ["event"] },
                { options: [{ value: "1" }, { value: "2" }, { value: "none" }] },
            ]);
        },
    );

    it("lists no highlights as none pinned", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const { fields } = layOutPinForm(view({ highlights: { entries: [], wouldUnpin: undefined } }));

        expect(field(fields, "highlights-now")).toHaveProperty("defaultValue", "None pinned.");
    });

    it("offers six slots at most, defaulting to the sixth when all six are taken", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const six = ["a", "b", "c", "d", "e", "f"].map((id: string): HighlightEntry => entry(`t3_${id}`, id));
        const slot = field(layOutPinForm(view({ highlights: { entries: six, wouldUnpin: undefined } })).fields, "slot");

        expect(slot).toMatchObject({ defaultValue: ["6"], options: { length: 7 } });
    });

    it("notes a managed thread's live post, defaulting its label to Megathread", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        const slotted = layOutPinForm(
            view({ managedBy: { configName: "regular-mt", pin: { kind: "slot", slot: 1 } } }),
        );
        const kept = layOutPinForm(view({ managedBy: { configName: "regular-mt", pin: { kind: "keepSlot" } } }));

        expect(slotted.description).toBe(
            "Slots 1 and 2 are old.reddit's two stickies. This is thread config regular-mt's live post; it returns to slot 1 at its next rotation.",
        );
        expect(kept.description).toBe(
            "Slots 1 and 2 are old.reddit's two stickies. This is thread config regular-mt's live post; each new live post takes its slot.",
        );
        expect(field(slotted.fields, "label")).toHaveProperty("defaultValue", ["megathread"]);
    });

    it("opens the description with a notice", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(layOutPinForm(view({ notice: "Look again." })).description).toBe(
            "Look again. Slots 1 and 2 are old.reddit's two stickies.",
        );
    });

    it("asks to confirm the post Reddit would unpin when all six are taken", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const { fields } = layOutPinForm(
            view({ highlights: { entries: [WEEKLY], wouldUnpin: { id: "t3_p6", title: "Probe 6" } } }),
        );

        expect(field(fields, "confirmUnpin")).toStrictEqual({
            type: "select",
            name: "confirmUnpin",
            label: 'Unpin "Probe 6"',
            helpText: "All six highlights are taken: pinning this post unpins this one.",
            options: [{ label: 'Unpin "Probe 6"', value: "t3_p6" }],
            required: false,
        });
    });
});
