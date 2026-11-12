import { describe, expect, it } from "vitest";
import type { PinChange } from "./changes/index.js";
import {
    BUSY_TOAST,
    confirmNotice,
    describeOutcome,
    describePinLog,
    notModeratorToast,
    notThisSubredditToast,
    PERMISSION_TOAST,
    UNCHANGED_TOAST,
} from "./pinText.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const PINNED: PinChange = {
    kind: "pin",
    at: new Date("2026-11-11T22:31:00Z"),
    moderator: "mod_user",
    action: "pinned",
    post: { id: "t3_ama", title: "AMA" },
    fromSlot: undefined,
    toSlot: 2,
    label: "Event",
    unpinned: undefined,
};
const MOVED: PinChange = { ...PINNED, action: "moved", fromSlot: 3, toSlot: 1, label: undefined };
const RELABELLED: PinChange = { ...PINNED, action: "relabelled", fromSlot: 2, label: "Announcement" };
const UNPINNED: PinChange = { ...PINNED, action: "unpinned", fromSlot: 2, toSlot: undefined, label: undefined };

describe(describeOutcome, (): void => {
    it.for<readonly [PinChange, string]>([
        [PINNED, 'Pinned "AMA" to slot 2.'],
        [MOVED, 'Moved "AMA" to slot 1.'],
        [RELABELLED, 'Changed the label of "AMA".'],
        [UNPINNED, 'Unpinned "AMA".'],
    ])("words %o as %s", TEST_OPTIONS, ([change, toast]: readonly [PinChange, string]): void => {
        expect.assertions(1);

        expect(describeOutcome(change)).toBe(toast);
    });

    it("cuts a title over 60 characters", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeOutcome({ ...PINNED, post: { id: "t3_ama", title: "x".repeat(61) } })).toBe(
            `Pinned "${"x".repeat(59)}…" to slot 2.`,
        );
    });
});

describe(describePinLog, (): void => {
    it.for<readonly [PinChange, string]>([
        [PINNED, "u/mod_user pinned post t3_ama to slot 2 (Event)."],
        [MOVED, "u/mod_user moved post t3_ama from slot 3 to slot 1 (no label)."],
        [RELABELLED, "u/mod_user changed the label of post t3_ama in slot 2 to Announcement."],
        [{ ...RELABELLED, label: undefined }, "u/mod_user changed the label of post t3_ama in slot 2 to none."],
        [UNPINNED, "u/mod_user unpinned post t3_ama from slot 2."],
        [
            { ...PINNED, unpinned: { id: "t3_f", title: "Probe 6" } },
            "u/mod_user pinned post t3_ama to slot 2 (Event). Reddit unpinned t3_f.",
        ],
    ])("logs %o as %s", TEST_OPTIONS, ([change, line]: readonly [PinChange, string]): void => {
        expect.assertions(1);

        expect(describePinLog(change)).toBe(line);
    });
});

describe("the pin toasts", (): void => {
    it("word every refusal, the busy and the unchanged case", TEST_OPTIONS, (): void => {
        expect.assertions(5);

        expect(notModeratorToast("testsub")).toBe("Only moderators of r/testsub can pin with Sticky Manager.");
        expect(notThisSubredditToast("testsub")).toBe("That post is not in r/testsub.");
        expect(PERMISSION_TOAST).toBe(
            "Pinning with Sticky Manager needs the Everything or Posts moderator permission.",
        );
        expect(BUSY_TOAST).toBe("That thread is being refreshed. Try again in a minute.");
        expect(UNCHANGED_TOAST).toBe("Nothing to change.");
    });

    it("asks the moderator to confirm the post Reddit would unpin", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(confirmNotice({ id: "t3_f", title: "Probe 6" })).toBe(
            'Pinning this post unpins "Probe 6": confirm below to go ahead.',
        );
    });
});
