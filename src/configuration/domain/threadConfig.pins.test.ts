import { describe, expect, it } from "vitest";
import { checkThreadConfigs, checkThreadConfigSchema, getPin } from "./threadConfig.js";
import type { Pin, ThreadConfig } from "./threadConfig.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MINIMAL_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    maxComments: 200,
    body: "Hello world",
};

function pinned(name: string, fields: Partial<ThreadConfig> = {}): ThreadConfig {
    return { ...MINIMAL_CONFIG, name, sticky: true, ...fields };
}

describe(getPin, (): void => {
    it.for<readonly [Partial<ThreadConfig>, Pin]>([
        [{ slot: 2 }, { kind: "slot", slot: 2 }],
        [
            { slot: 2, sticky: true },
            { kind: "slot", slot: 2 },
        ],
        [{ sticky: true }, { kind: "keepSlot" }],
        [{ sticky: true, slot: null }, { kind: "keepSlot" }],
        [{}, { kind: "none" }],
        [{ sticky: false }, { kind: "none" }],
        [{ sticky: null }, { kind: "none" }],
    ])("reads %o as %o", TEST_OPTIONS, ([fields, pin]: readonly [Partial<ThreadConfig>, Pin]): void => {
        expect.assertions(1);

        expect(getPin({ ...MINIMAL_CONFIG, ...fields })).toStrictEqual(pin);
    });
});

describe("checkThreadConfigSchema on slots", (): void => {
    it.for([0, 7, 1.5, "1"])("rejects the slot %j", TEST_OPTIONS, (slot: number | string): void => {
        expect.assertions(1);

        expect(checkThreadConfigSchema([{ ...MINIMAL_CONFIG, slot }]).kind).toBe("invalid");
    });

    it.for([1, 6])("accepts the slot %i", TEST_OPTIONS, (slot: number): void => {
        expect.assertions(1);

        expect(checkThreadConfigSchema([{ ...MINIMAL_CONFIG, slot }]).kind).toBe("valid");
    });
});

describe("checkThreadConfigs on pins", (): void => {
    it("rejects a slot with sticky turned off", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigs([{ ...MINIMAL_CONFIG, slot: 1, sticky: false }])).toStrictEqual({
            kind: "invalid",
            problem: {
                kind: "invalidValue",
                configName: "daily-thread",
                reason: "it sets a slot but turns sticky off",
            },
        });
    });

    it("rejects two enabled thread configs asking for one slot, naming both in page order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            checkThreadConfigs([pinned("a", { slot: 1 }), pinned("b", { slot: 2 }), pinned("c", { slot: 1 })]),
        ).toStrictEqual({ kind: "invalid", problem: { kind: "sharedSlot", slot: 1, configNames: ["a", "c"] } });
    });

    it("lets a disabled thread config share a slot", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigs([pinned("a", { slot: 1 }), pinned("b", { slot: 1, enabled: false })]).kind).toBe(
            "valid",
        );
    });

    it("rejects a seventh enabled pinned thread config", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const seven = ["a", "b", "c", "d", "e", "f", "g"].map((name: string): ThreadConfig => pinned(name));

        expect(checkThreadConfigs(seven)).toStrictEqual({
            kind: "invalid",
            problem: { kind: "tooManyPinned", count: 7 },
        });
    });

    it("accepts six enabled pinned thread configs beside unpinned and disabled ones", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const six = ["a", "b", "c", "d", "e", "f"].map((name: string): ThreadConfig => pinned(name));
        const others = [{ ...MINIMAL_CONFIG, name: "g" }, pinned("h", { enabled: false })];

        expect(checkThreadConfigs([...six, ...others]).kind).toBe("valid");
    });

    it("reports duplicate names before pins", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(checkThreadConfigs([pinned("a", { slot: 1 }), pinned("a", { slot: 1 })])).toStrictEqual({
            kind: "invalid",
            problem: { kind: "duplicateNames" },
        });
    });
});
