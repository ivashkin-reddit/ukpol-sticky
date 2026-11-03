import { describe, expect, it, vi } from "vitest";
import { createFakePost, createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakePost, FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { ManagedPost } from "./ports.js";
import { refreshAllThreads } from "./rotation.js";

// A rotation is a run of Reddit and Redis calls that cannot be made atomic. These tests fail each step once, retry
// the refresh, and check what the rotation guarantees: the old post gets its end note at most once, the newest
// published post is the live post, and a replacement is published twice only when recording it failed.

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
}

/** A thread config whose live post t3_old is at its comment cap, over stores that keep what is written to them. */
function threadDueForRotation(): Rotation {
    const fakes = createFakeRotationPorts([CONFIG]);
    const oldPost = createFakePost({
        body: "Body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id: "t3_old",
        numberOfComments: 100,
        stickied: true,
    });
    const published: FakePost[] = [];
    const publishedById = new Map<string, FakePost>();
    const livePostIds = new Map([[CONFIG.name, "t3_old"]]);
    fakes.livePosts.get.mockImplementation(async (configName: string): Promise<string | undefined> => {
        await Promise.resolve();
        return livePostIds.get(configName);
    });
    fakes.livePosts.set.mockImplementation(async (configName: string, postId: string): Promise<void> => {
        await Promise.resolve();
        livePostIds.set(configName, postId);
    });
    fakes.posts.get.mockImplementation(async (postId: string): Promise<ManagedPost> => {
        const post = postId === "t3_old" ? oldPost : publishedById.get(postId);
        return await (post === undefined ? Promise.reject(new Error(`no post ${postId}`)) : Promise.resolve(post.post));
    });
    fakes.posts.publish.mockImplementation(async (): Promise<ManagedPost> => {
        const post = createFakePost({
            body: "Body",
            createdAt: new Date(),
            id: `t3_new${String(published.length + 1)}`,
            numberOfComments: 0,
            stickied: false,
        });
        published.push(post);
        publishedById.set(post.post.id, post);
        return await Promise.resolve(post.post);
    });
    return { fakes, oldPost, published };
}

type FailingStep = "distinguish" | "endNote" | "lock" | "publish" | "record" | "sticky" | "unsticky";

interface FaultCase {
    readonly failing: FailingStep;
    readonly publishedPosts: number;
    readonly endNotes: number;
    readonly locks: number;
}

const FAULT_CASES: readonly FaultCase[] = [
    { failing: "unsticky", publishedPosts: 1, endNotes: 1, locks: 1 },
    { failing: "publish", publishedPosts: 1, endNotes: 1, locks: 1 },
    // The one step a retry repeats: Reddit has the post, but it was never recorded as the live post.
    { failing: "record", publishedPosts: 2, endNotes: 1, locks: 1 },
    // A failure after the replacement is recorded leaves the old post as it is rather than retiring it twice.
    { failing: "distinguish", publishedPosts: 1, endNotes: 0, locks: 0 },
    { failing: "sticky", publishedPosts: 1, endNotes: 0, locks: 0 },
    { failing: "endNote", publishedPosts: 1, endNotes: 0, locks: 0 },
    { failing: "lock", publishedPosts: 1, endNotes: 1, locks: 0 },
];

describe("a rotation retried after one of its steps fails", (): void => {
    it.for(FAULT_CASES)(
        "repeats no side effect when $failing fails",
        TEST_OPTIONS,
        async (faultCase: FaultCase): Promise<void> => {
            expect.assertions(4);

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            silenceConsole("error");
            const { fakes, oldPost, published } = threadDueForRotation();
            const publish = fakes.posts.publish.getMockImplementation();
            switch (faultCase.failing) {
                case "unsticky":
                    oldPost.unsticky.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "publish":
                    fakes.posts.publish.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "record":
                    fakes.livePosts.set.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "distinguish":
                case "sticky": {
                    const failingAction = faultCase.failing;
                    fakes.posts.publish.mockImplementationOnce(
                        async (post: Readonly<{ title: string; body: string }>): Promise<ManagedPost> => {
                            const publishedPost = await (publish?.(post) ?? Promise.reject(new Error("no publish")));
                            published[0]?.[failingAction].mockRejectedValueOnce(STEP_FAILURE);
                            return publishedPost;
                        },
                    );
                    break;
                }
                case "endNote":
                    oldPost.addComment.mockRejectedValueOnce(STEP_FAILURE);
                    break;
                case "lock":
                    oldPost.lock.mockRejectedValueOnce(STEP_FAILURE);
                    break;
            }

            await expect(refreshAllThreads(fakes.ports)).rejects.toThrow(STEP_FAILURE.message);

            await refreshAllThreads(fakes.ports);

            const locks = oldPost.lock.mock.settledResults.filter(
                (result: Readonly<{ type: string }>): boolean => result.type === "fulfilled",
            );

            // An end note is a comment added and then distinguished.
            expect([published.length, oldPost.commentDistinguish.mock.calls.length, locks.length]).toStrictEqual([
                faultCase.publishedPosts,
                faultCase.endNotes,
                faultCase.locks,
            ]);
            expect(oldPost.addComment.mock.calls.length).toBeLessThanOrEqual(1);
            await expect(fakes.ports.livePosts.get(CONFIG.name)).resolves.toBe(
                published[published.length - 1]?.post.id,
            );
        },
    );
});
