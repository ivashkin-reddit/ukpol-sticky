import { describe, expect, it } from "vitest";
import type { PinChange } from "./changes/index.js";
import { describeChange, describeChanges } from "./statusText.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const PINNED: PinChange = {
    kind: "pin",
    at: new Date("2026-11-11T22:31:00Z"),
    moderator: "mod_user",
    action: "pinned",
    post: { id: "t3_ama", title: "AMA with someone" },
    fromSlot: undefined,
    toSlot: 2,
    label: "Event",
    unpinned: undefined,
};

describe(describeChange, (): void => {
    it.for<readonly [string, PinChange, string]>([
        ["a pin", PINNED, 'u/mod_user pinned "AMA with someone" to slot 2 (Event).'],
        [
            "a pin that unpinned another post",
            { ...PINNED, toSlot: 1, label: "Megathread", unpinned: { id: "t3_f", title: "Probe 3" } },
            'u/mod_user pinned "AMA with someone" to slot 1 (Megathread); Reddit unpinned "Probe 3".',
        ],
        [
            "a move",
            { ...PINNED, action: "moved", fromSlot: 3, toSlot: 1, label: undefined },
            'u/mod_user moved "AMA with someone" from slot 3 to slot 1.',
        ],
        [
            "a new label",
            { ...PINNED, action: "relabelled", fromSlot: 2, label: "Announcement" },
            'u/mod_user changed the label of "AMA with someone" in slot 2 to Announcement.',
        ],
        [
            "a label removed",
            { ...PINNED, action: "relabelled", fromSlot: 2, label: undefined },
            'u/mod_user changed the label of "AMA with someone" in slot 2 to none.',
        ],
        [
            "an unpin",
            { ...PINNED, action: "unpinned", fromSlot: 2, toSlot: undefined, label: undefined },
            'u/mod_user unpinned "AMA with someone" from slot 2.',
        ],
    ])("words %s", TEST_OPTIONS, ([, change, words]: readonly [string, PinChange, string]): void => {
        expect.assertions(1);

        expect(describeChange(change)).toBe(`2026-11-11 22:31 UTC, ${words}`);
    });

    it("cuts a title over 80 characters", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeChange({ ...PINNED, post: { id: "t3_ama", title: "x".repeat(81) } })).toBe(
            `2026-11-11 22:31 UTC, u/mod_user pinned "${"x".repeat(79)}…" to slot 2 (Event).`,
        );
    });
});

describe(describeChanges, (): void => {
    it("says when there are none", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeChanges([])).toBe("No changes yet.");
    });

    it("says when the change history could not be read", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeChanges("unreadable")).toBe("Could not read the change history.");
    });

    it("puts each change on its own line, in the order given", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const later: PinChange = { ...PINNED, at: new Date("2026-11-11T23:00:00Z"), action: "unpinned", fromSlot: 2 };

        expect(describeChanges([later, PINNED])).toBe(`${describeChange(later)}\n${describeChange(PINNED)}`);
    });
});
