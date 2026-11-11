import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { unlabelled } from "../../tests/support/fakeHighlights.js";
import { createFakePost, findingPostsById } from "../../tests/support/fakePosts.js";
import type { FakePost } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { Highlight } from "../highlights/index.js";
import { rotateLivePost } from "./threadRefresh.js";

const TEST_OPTIONS = { timeout: 1000 };

const ROTATING_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread {{date yyyy-MM-dd}}",
    maxComments: 200,
    body: "Replacement body",
    sticky: true,
    endNote: "Thread closed",
    lockOnRefresh: true,
};

interface Rotation {
    readonly fakes: FakeRotationPorts;
    readonly oldPost: FakePost;
    readonly replacement: FakePost;
}

/** Rotates `config`'s live post t3_old, pinned in slot 1 unless `highlights` says otherwise. */
async function rotate(
    config: ThreadConfig,
    highlights: readonly Highlight[] = unlabelled("t3_old"),
): Promise<Rotation> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts([], {}, highlights);
    const oldPost = createFakePost({
        body: "Old body",
        createdAt: new Date("2026-04-20T10:00:00Z"),
        id: "t3_old",
        numberOfComments: 5,
    });
    const replacement = createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id: "t3_replacement",
        numberOfComments: 0,
        title: "Daily thread 2026-04-21",
        permalink: "/r/testsub/comments/replacement/daily_thread_20260421/",
    });
    fakes.posts.publish.mockResolvedValue(replacement.post);
    fakes.posts.get.mockImplementation(findingPostsById([oldPost.post, replacement.post]));

    await rotateLivePost(oldPost.post, config, fakes.ports);
    return { fakes, oldPost, replacement };
}

describe(rotateLivePost, (): void => {
    it(
        "retires the old post: unpins it, adds the end note as a distinguished sticky comment and locks it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { fakes, oldPost } = await rotate(ROTATING_CONFIG);

            expect(fakes.highlights.unpin).toHaveBeenCalledExactlyOnceWith("t3_old");
            expect(oldPost.addComment).toHaveBeenCalledExactlyOnceWith({ text: "Thread closed" });
            expect(oldPost.commentDistinguish).toHaveBeenCalledExactlyOnceWith(true);
            expect(oldPost.lock).toHaveBeenCalledExactlyOnceWith();
        },
    );

    it("links the replacement where the end note has {{new post}}", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { oldPost } = await rotate({ ...ROTATING_CONFIG, endNote: "Please continue in {{new post}}." });

        expect(oldPost.addComment).toHaveBeenCalledExactlyOnceWith({
            text: "Please continue in [Daily thread 2026-04-21](/r/testsub/comments/replacement/daily_thread_20260421/).",
        });
    });

    it(
        "publishes the replacement with the dated title, then distinguishes it and pins it in the old post's slot",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { fakes, replacement } = await rotate(ROTATING_CONFIG);

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({
                title: "Daily thread 2026-04-21",
                body: "Replacement body",
            });
            expect(replacement.distinguish).toHaveBeenCalledExactlyOnceWith();
            expect(fakes.highlights.current()).toStrictEqual([{ postId: "t3_replacement", label: "megathread" }]);
        },
    );

    it("records the replacement as the live post and stores its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { fakes } = await rotate(ROTATING_CONFIG);

        expect(fakes.livePosts.set).toHaveBeenCalledExactlyOnceWith("daily-thread", "t3_replacement");
        expect(fakes.livePosts.storeCommentCap).toHaveBeenCalledExactlyOnceWith("t3_replacement", 200);
    });

    it(
        "leaves the old post open and the replacement unpinned when those keys were left empty",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { fakes, oldPost } = await rotate({
                ...ROTATING_CONFIG,
                endNote: null,
                lockOnRefresh: null,
                sticky: null,
            });

            expect(oldPost.addComment).not.toHaveBeenCalled();
            expect(oldPost.lock).not.toHaveBeenCalled();
            expect(fakes.highlights.current()).toStrictEqual([]);
        },
    );

    it("adds no comment for an empty end note", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { oldPost } = await rotate({ ...ROTATING_CONFIG, endNote: "" });

        expect(oldPost.addComment).not.toHaveBeenCalled();
    });

    it(
        "retires the old post only once its replacement is published and recorded, forgetting its comment cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { fakes, oldPost } = await rotate(ROTATING_CONFIG);

            expect(fakes.highlights.unpin).toHaveBeenCalledBefore(fakes.posts.publish);
            expect(fakes.livePosts.set).toHaveBeenCalledBefore(oldPost.addComment);
            expect(oldPost.addComment).toHaveBeenCalledBefore(oldPost.lock);
            expect(fakes.livePosts.forgetCommentCap).toHaveBeenCalledExactlyOnceWith("t3_old");
        },
    );

    it(
        "records the handover once the replacement is published, before anything else, and forgets it once the old post is retired",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { fakes, oldPost, replacement } = await rotate(ROTATING_CONFIG);

            expect(fakes.livePosts.saveHandover).toHaveBeenNthCalledWith(1, "daily-thread", {
                newPostId: "t3_replacement",
                oldPostId: "t3_old",
                slot: 1,
            });
            expect(fakes.posts.publish).toHaveBeenCalledBefore(fakes.livePosts.saveHandover);
            expect(fakes.livePosts.saveHandover).toHaveBeenCalledBefore(fakes.livePosts.set);
            expect(fakes.livePosts.saveHandover).toHaveBeenCalledBefore(replacement.distinguish);
            expect(fakes.livePosts.forgetHandover).toHaveBeenCalledAfter(oldPost.lock);
        },
    );

    it(
        "records a thread config's first post with a handover that retires nothing",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationPorts();
            const first = createFakePost({
                body: undefined,
                createdAt: new Date("2026-04-21T10:00:00Z"),
                id: "t3_first",
                numberOfComments: 0,
            });
            fakes.posts.publish.mockResolvedValue(first.post);
            fakes.posts.get.mockImplementation(findingPostsById([first.post]));

            await rotateLivePost(undefined, ROTATING_CONFIG, fakes.ports);

            expect(fakes.livePosts.saveHandover).toHaveBeenCalledExactlyOnceWith("daily-thread", {
                newPostId: "t3_first",
                slot: 6,
            });
            expect(fakes.livePosts.forgetHandover).toHaveBeenCalledExactlyOnceWith("daily-thread");
        },
    );
});
