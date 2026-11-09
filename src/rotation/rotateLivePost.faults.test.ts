import { describe, expect, it, vi } from "vitest";
import { createFakePost } from "../../tests/support/fakePosts.js";
import type { FakePost } from "../../tests/support/fakePosts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { createStoredRotationPorts } from "../../tests/support/storedLivePosts.js";
import type { LivePostStore } from "../../tests/support/storedLivePosts.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { ManagedComment, ManagedPost } from "./ports.js";
import { refreshThreadConfig } from "./rotation.js";

// A rotation is a run of Reddit and Redis calls that cannot be made atomic. These tests fail each step once, retry
// the refresh, and check that the retry finishes the rotation: the newest post is live, distinguished and stickied, and
// the old post is unstickied, locked and given its end note.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CONFIG: ThreadConfig = {
    name: "mt",
    enabled: true,
    title: "Megathread",
    maxComments: 100,
    body: "Body",
    sticky: true,
    endNote: "Moved on",
    lockOnRefresh: true,
};
const STEP_FAILURE = new Error("Reddit is down");

interface Rotation {
    readonly fakes: FakeRotationPorts;
    readonly oldPost: FakePost;
    /** Posts published successfully, in order. */
    readonly published: FakePost[];
    readonly store: LivePostStore;
    /** Makes the first post published fail `action` once. */
    readonly failOnFirstPublished: (action: "distinguish" | "sticky") => void;
}

/** A thread config whose live post t3_old is at its comment cap, over stores that keep what is written to them. */
function threadDueForRotation(): Rotation {
    const { fakes, store } = createStoredRotationPorts([CONFIG], { [CONFIG.name]: "t3_old" });
    const oldPost = createFakePost({
        body: "Body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id: "t3_old",
        numberOfComments: 100,
        stickied: true,
    });
    const published: FakePost[] = [];
    const postsById = new Map<string, FakePost>([[oldPost.post.id, oldPost]]);
    fakes.posts.get.mockImplementation(async (postId: string): Promise<ManagedPost> => {
        const post = postsById.get(postId)?.post;
        return await (post === undefined ? Promise.reject(new Error(`no post ${postId}`)) : Promise.resolve(post));
    });
    fakes.posts.getComment.mockImplementation(async (commentId: string): Promise<ManagedComment> => {
        const comment = oldPost.comment.id === commentId ? oldPost.comment : undefined;
        return await (comment === undefined
            ? Promise.reject(new Error(`no comment ${commentId}`))
            : Promise.resolve(comment));
    });
    const publish = async (): Promise<ManagedPost> => {
        const post = createFakePost({
            body: "Body",
            createdAt: new Date(),
            id: `t3_new${String(published.length + 1)}`,
            numberOfComments: 0,
            stickied: false,
        });
        published.push(post);
        postsById.set(post.post.id, post);
        return await Promise.resolve(post.post);
    };
    fakes.posts.publish.mockImplementation(publish);
    const failOnFirstPublished = (action: "distinguish" | "sticky"): void => {
        fakes.posts.publish.mockImplementationOnce(async (): Promise<ManagedPost> => {
            const post = await publish();
            published[0]?.[action].mockRejectedValueOnce(STEP_FAILURE);
            return post;
        });
    };
    return { fakes, oldPost, published, store, failOnFirstPublished };
}

type FailingStep =
    | "distinguish"
    | "endNote"
    | "endNoteDistinguish"
    | "lock"
    | "publish"
    | "recordEndNote"
    | "recordHandover"
    | "recordLivePost"
    | "sticky"
    | "unsticky";

interface FaultCase {
    readonly failing: FailingStep;
    readonly publishedPosts: number;
    readonly endNotes: number;
}

const FAULT_CASES: readonly FaultCase[] = [
    { failing: "unsticky", publishedPosts: 1, endNotes: 1 },
    { failing: "publish", publishedPosts: 1, endNotes: 1 },
    // Reddit has the post, but nothing recorded it: the retry publishes another. The first is left as it is.
    { failing: "recordHandover", publishedPosts: 2, endNotes: 1 },
    { failing: "recordLivePost", publishedPosts: 1, endNotes: 1 },
    { failing: "distinguish", publishedPosts: 1, endNotes: 1 },
    { failing: "sticky", publishedPosts: 1, endNotes: 1 },
    { failing: "endNote", publishedPosts: 1, endNotes: 1 },
    // Reddit has the end note, but its ID was not recorded: the retry adds another.
    { failing: "recordEndNote", publishedPosts: 1, endNotes: 2 },
    { failing: "endNoteDistinguish", publishedPosts: 1, endNotes: 1 },
    { failing: "lock", publishedPosts: 1, endNotes: 1 },
];

/** How many of a mock's calls succeeded. */
function fulfilled(settledResults: readonly Readonly<{ type: string }>[]): number {
    return settledResults.filter((result: Readonly<{ type: string }>): boolean => result.type === "fulfilled").length;
}

describe("a rotation retried after one of its steps fails", (): void => {
    it.for(FAULT_CASES)(
        "is finished by the retry when $failing fails",
        TEST_OPTIONS,
        async (faultCase: FaultCase): Promise<void> => {
            expect.assertions(5);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            silenceConsole("error");
            const { fakes, oldPost, published, store, failOnFirstPublished } = threadDueForRotation();
            const saveHandover = fakes.livePosts.saveHandover.getMockImplementation();
            switch (faultCase.failing) {
                case "unsticky":
                    oldPost.unsticky.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "publish":
                    fakes.posts.publish.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "recordHandover":
                    fakes.livePosts.saveHandover.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "recordLivePost":
                    fakes.livePosts.set.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "distinguish":
                case "sticky":
                    failOnFirstPublished(faultCase.failing);
                    break;
                case "endNote":
                    oldPost.addComment.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "recordEndNote":
                    // The first save records the handover; the second would record the end note's ID.
                    if (saveHandover !== undefined) {
                        fakes.livePosts.saveHandover
                            .mockImplementationOnce(saveHandover)
                            .mockRejectedValueOnce(STEP_FAILURE);
                    }

                    break;
                case "endNoteDistinguish":
                    oldPost.commentDistinguish.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "lock":
                    oldPost.lock.mockRejectedValueOnce(STEP_FAILURE);
                    break;
            }

            await expect(refreshThreadConfig(CONFIG.name, fakes.ports)).rejects.toThrow(STEP_FAILURE.message);

            await refreshThreadConfig(CONFIG.name, fakes.ports);

            const livePost = published[published.length - 1]?.post;

            expect([published.length, fulfilled(oldPost.addComment.mock.settledResults)]).toStrictEqual([
                faultCase.publishedPosts,
                faultCase.endNotes,
            ]);
            // The newest post is the live post, distinguished and stickied.
            expect([store.livePostIds.get(CONFIG.name), livePost?.distinguishedBy, livePost?.stickied]).toStrictEqual([
                livePost?.id,
                "moderator",
                true,
            ]);
            expect([
                oldPost.post.stickied,
                oldPost.post.locked,
                fulfilled(oldPost.commentDistinguish.mock.settledResults) > 0,
            ]).toStrictEqual([false, true, true]);
            expect([store.handovers.size, fakes.livePosts.forgetCommentCap.mock.lastCall]).toStrictEqual([
                0,
                ["t3_old"],
            ]);
        },
    );
});

describe("a rotation whose handover keeps failing", (): void => {
    it(
        "reports each refresh as failed, and keeps the alert claimed, until the handover is finished",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            silenceConsole("error");
            const { fakes, published, failOnFirstPublished } = threadDueForRotation();
            failOnFirstPublished("sticky");

            await expect(refreshThreadConfig(CONFIG.name, fakes.ports)).rejects.toThrow(STEP_FAILURE.message);

            published[0]?.sticky.mockRejectedValueOnce(STEP_FAILURE);

            await expect(refreshThreadConfig(CONFIG.name, fakes.ports)).rejects.toThrow(STEP_FAILURE.message);

            await refreshThreadConfig(CONFIG.name, fakes.ports);

            expect([
                fakes.refreshStatus.recordFailure.mock.calls.length,
                fakes.refreshStatus.recordSuccess.mock.calls.length,
            ]).toStrictEqual([2, 1]);
            expect(fakes.refreshStatus.recordSuccess).toHaveBeenCalledAfter(fakes.refreshStatus.recordFailure);
            expect(fakes.threadFailureAlert(CONFIG.name).release).toHaveBeenCalledAfter(
                fakes.refreshStatus.recordFailure,
            );
        },
    );
});
