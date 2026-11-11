import { describe, expect, it } from "vitest";
import type { Pin } from "../../configuration/index.js";
import { pinChange, rotationSlot } from "./pinRules.js";
import type { PinUpdate } from "./pinRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(rotationSlot, (): void => {
    it.for<readonly [string, Pin, number | undefined, number | undefined]>([
        ["its thread config's slot, wherever the old post was", { kind: "slot", slot: 1 }, 4, 1],
        ["its thread config's slot when the old post was not pinned", { kind: "slot", slot: 2 }, undefined, 2],
        ["the old post's slot for sticky alone", { kind: "keepSlot" }, 3, 3],
        ["last for sticky alone when the old post was not pinned", { kind: "keepSlot" }, undefined, 6],
        ["no slot when not pinned", { kind: "none" }, 2, undefined],
    ])(
        "gives %s",
        TEST_OPTIONS,
        ([, pin, oldSlot, slot]: readonly [string, Pin, number | undefined, number | undefined]): void => {
            expect.assertions(1);

            expect(rotationSlot(pin, oldSlot)).toBe(slot);
        },
    );
});

const SLOT_1: Pin = { kind: "slot", slot: 1 };
const SLOT_3: Pin = { kind: "slot", slot: 3 };
const KEEP: Pin = { kind: "keepSlot" };
const NONE: Pin = { kind: "none" };

describe(pinChange, (): void => {
    it.for<readonly [string, Pin | undefined, Pin, PinUpdate]>([
        ["nothing with no applied version", undefined, SLOT_1, { kind: "none" }],
        ["nothing with no applied version, even unpinned", undefined, NONE, { kind: "none" }],
        ["nothing for the same slot", SLOT_1, SLOT_1, { kind: "none" }],
        ["a place for a new slot", NONE, { kind: "slot", slot: 2 }, { kind: "place", slot: 2 }],
        ["a place for a slot set where sticky was", KEEP, { kind: "slot", slot: 2 }, { kind: "place", slot: 2 }],
        ["a place for a changed slot", SLOT_1, SLOT_3, { kind: "place", slot: 3 }],
        ["a pin if unpinned for newly sticky", NONE, KEEP, { kind: "pinIfUnpinned" }],
        ["nothing for a slot removed while sticky stays", SLOT_1, KEEP, { kind: "none" }],
        ["nothing for sticky unchanged", KEEP, KEEP, { kind: "none" }],
        ["an unpin for a slot removed", SLOT_1, NONE, { kind: "unpin" }],
        ["an unpin for sticky turned off", KEEP, NONE, { kind: "unpin" }],
        ["nothing for unpinned unchanged", NONE, NONE, { kind: "none" }],
    ])(
        "gives %s",
        TEST_OPTIONS,
        ([, applied, current, update]: readonly [string, Pin | undefined, Pin, PinUpdate]): void => {
            expect.assertions(1);

            expect(pinChange(applied, current)).toStrictEqual(update);
        },
    );
});
