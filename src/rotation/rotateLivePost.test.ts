import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakePost, createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakePost, FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { ThreadConfig } from "../configuration/index.js";
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

async function rotate(config: ThreadConfig): Promise<Rotation> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts();
    const oldPost = createFakePost({
        body: "Old body",
        createdAt: new Date("2026-04-20T10:00:00Z"),
        id: "t3_old",
        numberOfComments: 5,
        stickied: true,
    });
    const replacement = createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id: "t3_replacement",
        numberOfComments: 0,
        stickied: false,
    });
    fakes.posts.publish.mockResolvedValue(replacement.post);

    await rotateLivePost(oldPost.post, config, fakes.ports);
    return { fakes, oldPost, replacement };
}

describe(rotateLivePost, (): void => {
    it(
        "retires the old post: unstickies it, adds the end note as a distinguished sticky comment and locks it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { oldPost } = await rotate(ROTATING_CONFIG);

            expect(oldPost.unsticky).toHaveBeenCalledExactlyOnceWith();
            expect(oldPost.addComment).toHaveBeenCalledExactlyOnceWith({ text: "Thread closed" });
            expect(oldPost.commentDistinguish).toHaveBeenCalledExactlyOnceWith(true);
            expect(oldPost.lock).toHaveBeenCalledExactlyOnceWith();
        },
    );

    it(
        "publishes the replacement with the dated title, then distinguishes and stickies it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { fakes, replacement } = await rotate(ROTATING_CONFIG);

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith({
                title: "Daily thread 2026-04-21",
                body: "Replacement body",
            });
            expect(replacement.distinguish).toHaveBeenCalledExactlyOnceWith();
            expect(replacement.sticky).toHaveBeenCalledExactlyOnceWith();
        },
    );

    it("records the replacement as the live post and stores its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { fakes } = await rotate(ROTATING_CONFIG);

        expect(fakes.livePosts.set).toHaveBeenCalledExactlyOnceWith("daily-thread", "t3_replacement");
        expect(fakes.livePosts.storeCommentCap).toHaveBeenCalledExactlyOnceWith("t3_replacement", 200);
    });

    it(
        "leaves the old post open and the replacement unstickied when those keys were left empty",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { oldPost, replacement } = await rotate({
                ...ROTATING_CONFIG,
                endNote: null,
                lockOnRefresh: null,
                sticky: null,
            });

            expect(oldPost.addComment).not.toHaveBeenCalled();
            expect(oldPost.lock).not.toHaveBeenCalled();
            expect(replacement.sticky).not.toHaveBeenCalled();
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

            expect(oldPost.unsticky).toHaveBeenCalledBefore(fakes.posts.publish);
            expect(fakes.livePosts.set).toHaveBeenCalledBefore(oldPost.addComment);
            expect(oldPost.addComment).toHaveBeenCalledBefore(oldPost.lock);
            expect(fakes.livePosts.forgetCommentCap).toHaveBeenCalledExactlyOnceWith("t3_old");
        },
    );
});
