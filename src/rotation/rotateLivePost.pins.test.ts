import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { unlabelled } from "../../tests/support/fakeHighlights.js";
import { createFakePost, findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { Highlight } from "../highlights/index.js";
import { rotateLivePost } from "./threadRefresh.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread {{date yyyy-MM-dd}}",
    maxComments: 200,
    body: "Body",
};

const REPLACEMENT: Highlight = { postId: "t3_replacement", label: "megathread" };
const AMA: Highlight = { postId: "t3_ama", label: "event" };

/** Rotates `config`'s live post t3_old with the highlights starting as `highlights`; returns the fakes. */
async function rotate(config: ThreadConfig, highlights: readonly Highlight[]): Promise<FakeRotationPorts> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts([], {}, highlights);
    const createdAt = new Date("2026-04-20T10:00:00Z");
    const oldPost = createFakePost({ body: "Body", createdAt, id: "t3_old", numberOfComments: 5 });
    const replacement = createFakePost({
        body: undefined,
        createdAt,
        id: "t3_replacement",
        numberOfComments: 0,
        title: "Daily thread 2026-04-21",
        permalink: "/r/testsub/comments/replacement/daily_thread_20260421/",
    });
    const unpinned = createFakePost({ body: "Body", createdAt, id: "t3_f", numberOfComments: 0, title: "Probe 6" });
    fakes.posts.publish.mockResolvedValue(replacement.post);
    fakes.posts.get.mockImplementation(findingPostsById([oldPost.post, replacement.post, unpinned.post]));

    await rotateLivePost(oldPost.post, config, fakes.ports);
    return fakes;
}

describe("rotateLivePost's pins", (): void => {
    it(
        "pins the replacement in its thread config's slot, wherever the old post was",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const fakes = await rotate({ ...CONFIG, slot: 1 }, [AMA, ...unlabelled("t3_old")]);

            expect(fakes.highlights.current()).toStrictEqual([REPLACEMENT, AMA]);
        },
    );

    it("pins the replacement in the old post's slot for sticky alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = await rotate({ ...CONFIG, sticky: true }, unlabelled("t3_weekly", "t3_old", "t3_other"));

        expect(fakes.highlights.current()).toStrictEqual([
            ...unlabelled("t3_weekly"),
            REPLACEMENT,
            ...unlabelled("t3_other"),
        ]);
    });

    it(
        "pins the replacement last for sticky alone when the old post was not pinned",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const fakes = await rotate({ ...CONFIG, sticky: true }, unlabelled("t3_a", "t3_b"));

            expect(fakes.highlights.current()).toStrictEqual([...unlabelled("t3_a", "t3_b"), REPLACEMENT]);
        },
    );

    it(
        "unpins a pinned old post and pins nothing for a thread config that is not pinned",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = await rotate(CONFIG, unlabelled("t3_old", "t3_a"));

            expect(fakes.highlights.current()).toStrictEqual(unlabelled("t3_a"));
            expect(fakes.highlights.pin).not.toHaveBeenCalled();
        },
    );

    it("unpins an old post in slot 3, which reads as not stickied on Reddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = await rotate({ ...CONFIG, slot: 3 }, unlabelled("t3_a", "t3_b", "t3_old"));

        expect(fakes.highlights.current()).toStrictEqual([...unlabelled("t3_a", "t3_b"), REPLACEMENT]);
    });

    it("logs where the replacement was placed", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await rotate({ ...CONFIG, slot: 1 }, unlabelled("t3_old"));

        expect(vi.mocked(console.log)).toHaveBeenCalledWith(
            "Placed live post t3_replacement of thread config daily-thread in slot 1 (it was not pinned).",
        );
    });

    it("tells moderators which post Reddit unpinned to make room", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = await rotate({ ...CONFIG, slot: 1 }, unlabelled("t3_a", "t3_b", "t3_c", "t3_d", "t3_e", "t3_f"));

        expect(fakes.highlights.current()).toStrictEqual([
            REPLACEMENT,
            ...unlabelled("t3_a", "t3_b", "t3_c", "t3_d", "t3_e"),
        ]);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith({
            subject: "Sticky Manager unpinned a post to pin thread config daily-thread",
            bodyMarkdown: [
                "Pinning thread config daily-thread's live post [Daily thread 2026-04-21](https://www.reddit.com/r/testsub/comments/replacement/daily_thread_20260421/) into slot 1 needed a seventh highlight, so Reddit unpinned [Probe 6](https://www.reddit.com/r/testsub/comments/f/).",
                'Pin it again with "Pin to slot" if it should stay.',
            ].join("\n\n"),
        });
    });
});
