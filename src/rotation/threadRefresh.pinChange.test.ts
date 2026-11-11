import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { unlabelled } from "../../tests/support/fakeHighlights.js";
import { createFakePost, findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { Highlight } from "../highlights/index.js";
import type { ThreadOutcome } from "./threadRefresh.js";
import { refreshThread } from "./threadRefresh.js";

// A refresh of a live post that is not due moves it only when its thread config's slot or sticky setting changed since
// the version its last refresh applied.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

// Rotated only at its comment cap, and well below it, so a refresh never rotates it.
const CONFIG: ThreadConfig = { name: "weekly", enabled: true, title: "Weekly", maxComments: 100, body: "Body" };
const LIVE: Highlight = { postId: "t3_live", label: "megathread" };

interface PinChangeRefresh {
    readonly fakes: FakeRotationPorts;
    readonly outcome: ThreadOutcome;
}

/** Refreshes `current`'s live post t3_live, after a refresh applied `applied` (none when undefined). */
async function refreshAfter(
    applied: ThreadConfig | undefined,
    current: ThreadConfig,
    highlights: readonly Highlight[],
): Promise<PinChangeRefresh> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts(applied === undefined ? [] : [applied], {}, highlights);
    const live = createFakePost({
        body: "Body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id: "t3_live",
        numberOfComments: 1,
    });
    fakes.livePosts.get.mockResolvedValue("t3_live");
    fakes.posts.get.mockImplementation(findingPostsById([live.post]));
    const outcome = await refreshThread(current, fakes.ports);
    return { fakes, outcome };
}

describe("refreshThread when a thread config's pin setting changed", (): void => {
    it("places the live post in a newly set slot at once", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { fakes, outcome } = await refreshAfter(
            { ...CONFIG, sticky: true },
            { ...CONFIG, sticky: true, slot: 1 },
            unlabelled("t3_a", "t3_live"),
        );

        expect(fakes.highlights.current()).toStrictEqual([LIVE, ...unlabelled("t3_a")]);
        expect(outcome).toBe("updated");
    });

    it(
        "unpins the live post when its thread config is no longer pinned, and logs it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { fakes, outcome } = await refreshAfter({ ...CONFIG, slot: 1 }, CONFIG, [
                LIVE,
                ...unlabelled("t3_a"),
            ]);

            expect(fakes.highlights.current()).toStrictEqual(unlabelled("t3_a"));
            expect(outcome).toBe("updated");
            expect(vi.mocked(console.log)).toHaveBeenCalledWith(
                "Unpinned live post t3_live of thread config weekly from slot 1.",
            );
        },
    );

    it("pins the live post last when its thread config is newly sticky", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { fakes } = await refreshAfter(CONFIG, { ...CONFIG, sticky: true }, unlabelled("t3_a"));

        expect(fakes.highlights.current()).toStrictEqual([...unlabelled("t3_a"), LIVE]);
    });

    it(
        "leaves a live post already pinned where it is when its thread config is newly sticky",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { fakes, outcome } = await refreshAfter(
                CONFIG,
                { ...CONFIG, sticky: true },
                unlabelled("t3_live", "t3_a"),
            );

            expect(fakes.highlights.pin).not.toHaveBeenCalled();
            expect(outcome).toBe("unchanged");
        },
    );

    it(
        "leaves a live post a moderator moved alone while its setting is unchanged",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const slotted: ThreadConfig = { ...CONFIG, slot: 1 };
            const { fakes, outcome } = await refreshAfter(slotted, slotted, [...unlabelled("t3_a", "t3_b"), LIVE]);

            expect(fakes.highlights.current()).toStrictEqual([...unlabelled("t3_a", "t3_b"), LIVE]);
            expect([fakes.highlights.pin.mock.calls, fakes.highlights.reorder.mock.calls]).toStrictEqual([[], []]);
            expect(outcome).toBe("unchanged");
        },
    );

    it("moves nothing when no version was applied before", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { fakes } = await refreshAfter(undefined, { ...CONFIG, slot: 1 }, unlabelled("t3_a", "t3_live"));

        expect(fakes.highlights.current()).toStrictEqual(unlabelled("t3_a", "t3_live"));
    });
});
