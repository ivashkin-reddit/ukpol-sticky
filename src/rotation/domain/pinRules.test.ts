import { describe, expect, it } from "vitest";
import type { Pin } from "../../configuration/index.js";
import { rotationSlot } from "./pinRules.js";

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
