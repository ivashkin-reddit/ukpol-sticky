import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakePost, findingPostsById } from "../../tests/support/fakePosts.js";
import type { FakePost, FakePostFields } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { COMMENT_CAP, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { Handover } from "./ports.js";
import { refreshThread } from "./threadRefresh.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(refreshThread, (): void => {
    it(
        "skips a thread config another invocation is refreshing, without reading it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.threadLocks.tryLock.mockResolvedValue(false);

            await expect(refreshThread(STICKY_CONFIG, fakes.ports)).resolves.toBe("skipped");
            expect(fakes.livePosts.get).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Skipping thread config sticky-thread: another refresh of it is under way.",
            );
        },
    );

    it("releases the thread config's lock when its refresh fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        const publishError = new Error("Reddit is down");
        fakes.posts.publish.mockRejectedValue(publishError);

        await expect(refreshThread(STICKY_CONFIG, fakes.ports)).rejects.toBe(publishError);
        expect(fakes.threadLocks.unlock).toHaveBeenCalledExactlyOnceWith("sticky-thread");
    });

    it(
        "keeps the refresh's own failure when releasing the lock also fails, and logs that one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const errorSpy = silenceConsole("error");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            const publishError = new Error("Reddit is down");
            const unlockError = new Error("Redis is down");
            fakes.posts.publish.mockRejectedValue(publishError);
            fakes.threadLocks.unlock.mockRejectedValue(unlockError);

            await expect(refreshThread(STICKY_CONFIG, fakes.ports)).rejects.toBe(publishError);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Could not release the lock on thread config sticky-thread after its refresh failed; the lock expires on its own:",
                unlockError,
            );
        },
    );
});

const RETIRING_CONFIG: ThreadConfig = { ...STICKY_CONFIG, endNote: "Moved on", lockOnRefresh: true };

// The new live post, just published, and the old one it replaces, unstickied at the start of the rotation.
const NEW_POST: FakePostFields = {
    body: RETIRING_CONFIG.body,
    createdAt: new Date("2026-04-21T10:00:00Z"),
    id: "t3_new",
    numberOfComments: 0,
    stickied: false,
};
const OLD_POST: FakePostFields = {
    body: RETIRING_CONFIG.body,
    createdAt: new Date("2026-04-21T09:00:00Z"),
    id: "t3_old",
    numberOfComments: COMMENT_CAP,
    stickied: false,
};

interface UnfinishedHandover {
    readonly fakes: FakeRotationPorts;
    readonly replacement: FakePost;
    readonly oldPost: FakePost;
}

/** A thread config whose last rotation stopped after publishing t3_new: `handover` is what it recorded. */
function unfinishedHandover(
    handover: Handover,
    reddit: Readonly<{ newPost?: FakePostFields; oldPost?: FakePostFields }> = {},
): UnfinishedHandover {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts([RETIRING_CONFIG]);
    const replacement = createFakePost(reddit.newPost ?? NEW_POST);
    const oldPost = createFakePost(reddit.oldPost ?? OLD_POST);
    fakes.livePosts.handovers.mockResolvedValue({ [RETIRING_CONFIG.name]: handover });
    fakes.livePosts.get.mockResolvedValue("t3_new");
    fakes.posts.get.mockImplementation(findingPostsById([replacement.post, oldPost.post]));
    fakes.posts.getComment.mockResolvedValue(oldPost.comment);
    return { fakes, replacement, oldPost };
}

describe("refreshThread with a handover its rotation left unfinished", (): void => {
    it(
        "finishes it first: distinguishes and stickies the new post, retires the old one, then forgets the handover",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { fakes, replacement, oldPost } = unfinishedHandover({ newPostId: "t3_new", oldPostId: "t3_old" });

            await expect(refreshThread(RETIRING_CONFIG, fakes.ports)).resolves.toBe("resumed");
            expect([replacement.post.distinguishedBy, replacement.post.stickied]).toStrictEqual(["moderator", true]);
            expect(oldPost.addComment).toHaveBeenCalledExactlyOnceWith({ text: "Moved on" });
            // The end note is distinguished as a sticky comment, and the old post locked.
            expect([oldPost.commentDistinguish.mock.calls, oldPost.post.locked]).toStrictEqual([[[true]], true]);
            expect(fakes.livePosts.forgetHandover).toHaveBeenCalledExactlyOnceWith(RETIRING_CONFIG.name);
        },
    );

    it(
        "repeats no step Reddit shows done, and distinguishes the end note it recorded instead of adding another",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { fakes, replacement, oldPost } = unfinishedHandover(
                { newPostId: "t3_new", oldPostId: "t3_old", endNoteId: "t1_old" },
                {
                    newPost: { ...NEW_POST, distinguishedBy: "moderator", stickied: true },
                    oldPost: { ...OLD_POST, locked: true },
                },
            );

            await refreshThread(RETIRING_CONFIG, fakes.ports);

            expect(
                [replacement.distinguish, replacement.sticky, oldPost.lock, oldPost.addComment].map(
                    (action: Readonly<{ mock: Readonly<{ calls: readonly unknown[] }> }>): number =>
                        action.mock.calls.length,
                ),
            ).toStrictEqual([0, 0, 0, 0]);
            expect(fakes.posts.getComment).toHaveBeenCalledExactlyOnceWith("t1_old");
            expect(oldPost.commentDistinguish).toHaveBeenCalledExactlyOnceWith(true);
            expect(fakes.livePosts.forgetHandover).toHaveBeenCalledExactlyOnceWith(RETIRING_CONFIG.name);
        },
    );

    it(
        "records the end note's ID before distinguishing it, so a retry does not add a second",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { fakes, oldPost } = unfinishedHandover({ newPostId: "t3_new", oldPostId: "t3_old" });

            await refreshThread(RETIRING_CONFIG, fakes.ports);

            expect(fakes.livePosts.saveHandover).toHaveBeenCalledExactlyOnceWith(RETIRING_CONFIG.name, {
                newPostId: "t3_new",
                oldPostId: "t3_old",
                endNoteId: oldPost.comment.id,
            });
            expect(fakes.livePosts.saveHandover).toHaveBeenCalledBefore(oldPost.commentDistinguish);
        },
    );

    it(
        "keeps the handover, and fails the refresh, while one of its steps fails",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { fakes, oldPost } = unfinishedHandover({ newPostId: "t3_new", oldPostId: "t3_old" });
            const lockError = new Error("Reddit is down");
            oldPost.lock.mockRejectedValue(lockError);

            await expect(refreshThread(RETIRING_CONFIG, fakes.ports)).rejects.toBe(lockError);
            expect(fakes.livePosts.forgetHandover).not.toHaveBeenCalled();
            expect(fakes.threadLocks.unlock).toHaveBeenCalledExactlyOnceWith(RETIRING_CONFIG.name);
        },
    );
});
