import { describe, expect, it, vi } from "vitest";
import { createFakeChangeHistory } from "../../tests/support/fakeChangeHistory.js";
import type { FakeChangeHistory } from "../../tests/support/fakeChangeHistory.js";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeHighlights, unlabelled } from "../../tests/support/fakeHighlights.js";
import type { FakeHighlights } from "../../tests/support/fakeHighlights.js";
import type { PinChange } from "../changes/index.js";
import type { PinRequest } from "./pinToSlot.js";
import { describeHighlights, pinToSlot } from "./pinToSlot.js";
import type { Highlight, HighlightsPorts, ManagedPostLock } from "./ports.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = "2026-11-11T22:31:00Z";
const FULL = unlabelled("t3_a", "t3_b", "t3_c", "t3_d", "t3_e", "t3_f");

const REQUEST: PinRequest = {
    moderator: "mod_user",
    post: { id: "t3_ama", title: "AMA" },
    slot: 2,
    label: "event",
    confirmedUnpin: undefined,
};

const PINNED: PinChange = {
    kind: "pin",
    at: new Date(NOW),
    moderator: "mod_user",
    action: "pinned",
    post: { id: "t3_ama", title: "AMA" },
    fromSlot: undefined,
    toSlot: 2,
    label: "Event",
    unpinned: undefined,
};

interface PinWorld {
    readonly ports: HighlightsPorts;
    readonly highlights: FakeHighlights;
    readonly history: FakeChangeHistory;
}

/** Ports over the highlights `initial`, with a lock that runs (or, when `busy`, refuses) as rotation's would. */
function pinWorld(initial: readonly Highlight[], busy = false): PinWorld {
    freezeTime(NOW);
    const highlights = createFakeHighlights(initial);
    const history = createFakeChangeHistory();
    const managedPostLock: ManagedPostLock = async <Result>(
        _postId: string,
        run: () => Promise<Result>,
    ): Promise<Readonly<{ kind: "busy" }> | Readonly<{ kind: "ran"; result: Result }>> =>
        busy ? { kind: "busy" } : { kind: "ran", result: await run() };
    return {
        ports: { highlights: highlights.highlights, managedPostLock, changeHistory: history.store },
        highlights,
        history,
    };
}

describe(pinToSlot, (): void => {
    it("pins a post into its slot with its label, and records the change", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const world = pinWorld(unlabelled("t3_w", "t3_a"));

        await expect(pinToSlot(REQUEST, world.ports)).resolves.toStrictEqual({ kind: "changed", change: PINNED });
        expect(world.highlights.current()).toStrictEqual([
            ...unlabelled("t3_w"),
            { postId: "t3_ama", label: "event" },
            ...unlabelled("t3_a"),
        ]);
        expect(world.history.add).toHaveBeenCalledExactlyOnceWith(PINNED);
    });

    it("records a move, a new label and an unpin as such", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const world = pinWorld([...unlabelled("t3_a", "t3_b"), { postId: "t3_ama", label: "event" }]);

        await expect(pinToSlot({ ...REQUEST, slot: 1 }, world.ports)).resolves.toHaveProperty("change.action", "moved");
        await expect(pinToSlot({ ...REQUEST, slot: 1, label: "megathread" }, world.ports)).resolves.toHaveProperty(
            "change",
            { ...PINNED, action: "relabelled", fromSlot: 1, toSlot: 1, label: "Megathread" },
        );
        await expect(pinToSlot({ ...REQUEST, slot: undefined }, world.ports)).resolves.toHaveProperty("change", {
            ...PINNED,
            action: "unpinned",
            fromSlot: 1,
            toSlot: undefined,
            label: undefined,
        });
    });

    it(
        "changes and records nothing for a post already in its slot with its label",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const world = pinWorld([...unlabelled("t3_a"), { postId: "t3_ama", label: "event" }]);

            await expect(pinToSlot(REQUEST, world.ports)).resolves.toStrictEqual({ kind: "unchanged" });
            expect(world.history.add).not.toHaveBeenCalled();
        },
    );

    it(
        "changes and records nothing when unpinning a post that is not pinned",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const world = pinWorld(unlabelled("t3_a"));

            await expect(pinToSlot({ ...REQUEST, slot: undefined }, world.ports)).resolves.toStrictEqual({
                kind: "unchanged",
            });
            expect(world.history.add).not.toHaveBeenCalled();
        },
    );

    it.for([undefined, "t3_e"])(
        "asks to confirm, pinning nothing, when all six are taken and the moderator confirmed %s",
        TEST_OPTIONS,
        async (confirmedUnpin: string | undefined): Promise<void> => {
            expect.assertions(2);

            const world = pinWorld(FULL);

            await expect(pinToSlot({ ...REQUEST, confirmedUnpin }, world.ports)).resolves.toStrictEqual({
                kind: "confirm",
                wouldUnpin: { id: "t3_f", title: "Title of t3_f" },
            });
            expect(world.highlights.pin).not.toHaveBeenCalled();
        },
    );

    it(
        "pins when the moderator confirmed the post Reddit unpins, and records it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const world = pinWorld(FULL);

            await expect(pinToSlot({ ...REQUEST, confirmedUnpin: "t3_f" }, world.ports)).resolves.toStrictEqual({
                kind: "changed",
                change: { ...PINNED, unpinned: { id: "t3_f", title: "Title of t3_f" } },
            });
        },
    );

    it(
        "is busy, pinning and recording nothing, while the managed thread's refresh holds its lock",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const world = pinWorld(unlabelled("t3_a"), true);

            await expect(pinToSlot(REQUEST, world.ports)).resolves.toStrictEqual({ kind: "busy" });
            expect(world.highlights.pin).not.toHaveBeenCalled();
            expect(world.history.add).not.toHaveBeenCalled();
        },
    );

    it("keeps a title whole up to 300 characters and cuts a longer one", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const world = pinWorld([]);
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);

        await expect(
            pinToSlot({ ...REQUEST, post: { id: "t3_ama", title: "x".repeat(301) } }, world.ports),
        ).resolves.toHaveProperty("change.post.title", `${"x".repeat(299)}…`);
    });
});

describe(describeHighlights, (): void => {
    it(
        "lists each highlight with its title and label, and the post a pin would unpin",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { highlights } = pinWorld([
                { postId: "t3_a", label: "megathread" },
                ...unlabelled("t3_b", "t3_c", "t3_d", "t3_e", "t3_f"),
            ]);

            const view = await describeHighlights("t3_x", highlights.highlights);

            expect([view.entries[0], view.entries[5], view.wouldUnpin]).toStrictEqual([
                { post: { id: "t3_a", title: "Title of t3_a" }, label: "megathread" },
                { post: { id: "t3_f", title: "Title of t3_f" }, label: undefined },
                { id: "t3_f", title: "Title of t3_f" },
            ]);
        },
    );

    it("unpins nothing for a post already pinned", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { highlights } = pinWorld(FULL);

        await expect(describeHighlights("t3_c", highlights.highlights)).resolves.toHaveProperty(
            "wouldUnpin",
            undefined,
        );
    });
});
