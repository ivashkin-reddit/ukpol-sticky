import { describe, expect, it } from "vitest";
import { placeInSlot, sameOrder, slotOf, wouldUnpin } from "./slotRules.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const ORDER = ["a", "b", "c"];
const FULL = ["a", "b", "c", "d", "e", "f"];

describe(slotOf, (): void => {
    it("counts slots from 1", TEST_OPTIONS, (): void => {
        expect.assertions(2);

        expect(slotOf(ORDER, "a")).toBe(1);
        expect(slotOf(ORDER, "c")).toBe(3);
    });

    it("is undefined for a post that is not pinned", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(slotOf(ORDER, "x")).toBeUndefined();
    });
});

describe(placeInSlot, (): void => {
    it.for<readonly [string, string, number, readonly string[]]>([
        ["a new post into slot 1", "x", 1, ["x", "a", "b", "c"]],
        ["a new post into slot 2", "x", 2, ["a", "x", "b", "c"]],
        ["a new post one past the end", "x", 4, ["a", "b", "c", "x"]],
        ["a new post far past the end, last", "x", 6, ["a", "b", "c", "x"]],
        ["a new post below slot 1, first", "x", 0, ["x", "a", "b", "c"]],
        ["a pinned post up", "c", 1, ["c", "a", "b"]],
        ["a pinned post down", "a", 3, ["b", "c", "a"]],
        ["a pinned post down past the end, last", "a", 6, ["b", "c", "a"]],
        ["a pinned post into its own slot", "b", 2, ["a", "b", "c"]],
    ])(
        "places %s",
        TEST_OPTIONS,
        ([, postId, slot, expected]: readonly [string, string, number, readonly string[]]): void => {
            expect.assertions(1);

            expect(placeInSlot(ORDER, postId, slot)).toStrictEqual(expected);
        },
    );

    it("places a post into an empty list", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(placeInSlot([], "x", 3)).toStrictEqual(["x"]);
    });
});

describe(wouldUnpin, (): void => {
    it("is the last post when all six are taken and the post is not one of them", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(wouldUnpin(FULL, "x")).toBe("f");
    });

    it("is undefined when the post is already pinned", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(wouldUnpin(FULL, "c")).toBeUndefined();
    });

    it("is undefined while there is room", TEST_OPTIONS, (): void => {
        expect.assertions(2);

        expect(wouldUnpin(ORDER, "x")).toBeUndefined();
        expect(wouldUnpin(FULL.slice(0, 5), "x")).toBeUndefined();
    });
});

describe(sameOrder, (): void => {
    it("is true for the same posts in the same order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(sameOrder(["a", "b"], ["a", "b"])).toBe(true);
    });

    it("is false for another order or another length", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        expect(sameOrder(["a", "b"], ["b", "a"])).toBe(false);
        expect(sameOrder(["a"], ["a", "b"])).toBe(false);
        expect(sameOrder(["a", "b"], ["a"])).toBe(false);
    });
});
