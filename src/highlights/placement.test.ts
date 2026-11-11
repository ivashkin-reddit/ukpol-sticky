import { describe, expect, it } from "vitest";
import { createFakeHighlights, unlabelled } from "../../tests/support/fakeHighlights.js";
import { placePost, unpinPost } from "./placement.js";
import type { Highlight } from "./ports.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MEGATHREAD_X: Highlight = { postId: "x", label: "megathread" };

describe(placePost, (): void => {
    it("pins a post not pinned and moves it into its slot", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const fake = createFakeHighlights(unlabelled("a", "b", "c"));

        await expect(placePost({ postId: "x", slot: 2, label: "megathread" }, fake.highlights)).resolves.toStrictEqual({
            fromSlot: undefined,
            toSlot: 2,
            unpinned: undefined,
            changed: true,
        });
        expect(fake.current()).toStrictEqual([...unlabelled("a"), MEGATHREAD_X, ...unlabelled("b", "c")]);
        expect(fake.pin).toHaveBeenCalledExactlyOnceWith("x", "megathread");
        expect(fake.reorder).toHaveBeenCalledExactlyOnceWith(["a", "x", "b", "c"]);
    });

    it("skips the reorder when Reddit already put the post in its slot", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeHighlights(unlabelled("a", "b"));

        await placePost({ postId: "x", slot: 1, label: undefined }, fake.highlights);

        expect(fake.pin).toHaveBeenCalledExactlyOnceWith("x", undefined);
        expect(fake.reorder).not.toHaveBeenCalled();
    });

    it("leaves a post already in its slot with its label alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fake = createFakeHighlights([...unlabelled("a"), MEGATHREAD_X]);

        await expect(placePost({ postId: "x", slot: 2, label: "megathread" }, fake.highlights)).resolves.toStrictEqual({
            fromSlot: 2,
            toSlot: 2,
            unpinned: undefined,
            changed: false,
        });
        expect(fake.pin).not.toHaveBeenCalled();
        expect(fake.reorder).not.toHaveBeenCalled();
    });

    it("does its work once when called twice", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fake = createFakeHighlights(unlabelled("a", "b"));

        await placePost({ postId: "x", slot: 2, label: "event" }, fake.highlights);

        await expect(placePost({ postId: "x", slot: 2, label: "event" }, fake.highlights)).resolves.toHaveProperty(
            "changed",
            false,
        );
        expect(fake.pin).toHaveBeenCalledExactlyOnceWith("x", "event");
        expect(fake.reorder).toHaveBeenCalledExactlyOnceWith(["a", "x", "b"]);
    });

    it("moves a pinned post without pinning it again", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fake = createFakeHighlights([...unlabelled("a", "b"), MEGATHREAD_X]);

        await expect(placePost({ postId: "x", slot: 1, label: "megathread" }, fake.highlights)).resolves.toStrictEqual({
            fromSlot: 3,
            toSlot: 1,
            unpinned: undefined,
            changed: true,
        });
        expect(fake.pin).not.toHaveBeenCalled();
        expect(fake.reorder).toHaveBeenCalledExactlyOnceWith(["x", "a", "b"]);
    });

    it("sets a new label in place", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fake = createFakeHighlights([...unlabelled("a"), { postId: "x", label: "event" }]);

        await expect(placePost({ postId: "x", slot: 2, label: "megathread" }, fake.highlights)).resolves.toStrictEqual({
            fromSlot: 2,
            toSlot: 2,
            unpinned: undefined,
            changed: true,
        });
        expect(fake.pin).toHaveBeenCalledExactlyOnceWith("x", "megathread");
        expect(fake.reorder).not.toHaveBeenCalled();
    });

    it("reports the post Reddit unpinned when all six were taken", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeHighlights(unlabelled("a", "b", "c", "d", "e", "f"));

        await expect(placePost({ postId: "x", slot: 1, label: "megathread" }, fake.highlights)).resolves.toStrictEqual({
            fromSlot: undefined,
            toSlot: 1,
            unpinned: "f",
            changed: true,
        });
        expect(fake.current().map((entry: Highlight): string => entry.postId)).toStrictEqual([
            "x",
            "a",
            "b",
            "c",
            "d",
            "e",
        ]);
    });

    it("puts a slot past the end last", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fake = createFakeHighlights(unlabelled("a"));

        await expect(placePost({ postId: "x", slot: 6, label: undefined }, fake.highlights)).resolves.toHaveProperty(
            "toSlot",
            2,
        );
    });
});

describe(unpinPost, (): void => {
    it("unpins a pinned post and returns the slot it had", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeHighlights(unlabelled("a", "b", "c"));

        await expect(unpinPost("b", fake.highlights)).resolves.toBe(2);
        expect(fake.current()).toStrictEqual(unlabelled("a", "c"));
    });

    it("leaves a post that is not pinned alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fake = createFakeHighlights(unlabelled("a"));

        await expect(unpinPost("x", fake.highlights)).resolves.toBeUndefined();
        expect(fake.unpin).not.toHaveBeenCalled();
    });
});
