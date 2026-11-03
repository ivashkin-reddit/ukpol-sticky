import { describe, expect, it, vi } from "vitest";
import { defer } from "../../tests/support/defer.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { COMMENT_CAP, commentOn, fullPost, newPost, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import type { ManagedPost } from "./ports.js";
import { refreshAllThreads, rotateIfCapReached } from "./rotation.js";

// Triggers and jobs run concurrently, each in its own invocation, sharing state only through the ports. These tests
// interleave two invocations on the same thread config and check that it is rotated once.

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const REPLACEMENT = { title: STICKY_CONFIG.title, body: STICKY_CONFIG.body };

interface FullThread {
    readonly fakes: FakeRotationPorts;
    /** Holds the next publish open; the returned function lets it finish. */
    readonly holdNextPublish: () => () => void;
}

/**
 * Rotation ports over one thread config whose live post t3_full is at its comment cap. The live post record and
 * the posts behave like the real stores: a post published is readable, and recording it replaces the live post.
 */
function fullThread(): FullThread {
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    const fakes = createFakeRotationPorts([STICKY_CONFIG]);
    const livePostIds = new Map([[STICKY_CONFIG.name, "t3_full"]]);
    const posts = new Map<string, ManagedPost>([["t3_full", fullPost("t3_full", COMMENT_CAP).post]]);
    fakes.livePosts.all.mockImplementation(async (): Promise<Readonly<Record<string, string>>> => {
        await Promise.resolve();
        return Object.fromEntries(livePostIds);
    });
    fakes.livePosts.get.mockImplementation(async (configName: string): Promise<string | undefined> => {
        await Promise.resolve();
        return livePostIds.get(configName);
    });
    fakes.livePosts.set.mockImplementation(async (configName: string, postId: string): Promise<void> => {
        await Promise.resolve();
        livePostIds.set(configName, postId);
    });
    fakes.livePosts.getCommentCap.mockResolvedValue(COMMENT_CAP);
    fakes.posts.get.mockImplementation(async (postId: string): Promise<ManagedPost> => {
        const post = posts.get(postId);
        return await (post === undefined ? Promise.reject(new Error(`no post ${postId}`)) : Promise.resolve(post));
    });
    const publish = async (): Promise<ManagedPost> => {
        const published = newPost(`t3_new${String(posts.size)}`).post;
        posts.set(published.id, published);
        return await Promise.resolve(published);
    };
    fakes.posts.publish.mockImplementation(publish);
    const holdNextPublish = (): (() => void) => {
        const released = defer<undefined>();
        fakes.posts.publish.mockImplementationOnce(async (): Promise<ManagedPost> => {
            await released.promise;
            return await publish();
        });
        return (): void => {
            released.resolve(undefined);
        };
    };
    return { fakes, holdNextPublish };
}

describe("concurrent rotations of one thread config", (): void => {
    it(
        "publish one replacement when two comments reach the comment cap together",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { fakes, holdNextPublish } = fullThread();
            const releasePublish = holdNextPublish();

            const first = rotateIfCapReached(commentOn("t3_full"), fakes.ports);
            await vi.waitFor((): void => {
                expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith(REPLACEMENT);
            });
            await rotateIfCapReached(commentOn("t3_full"), fakes.ports);
            releasePublish();
            await first;

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith(REPLACEMENT);
        },
    );

    it(
        "publish one replacement when a comment reaches the cap during a refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            const { fakes, holdNextPublish } = fullThread();
            const releasePublish = holdNextPublish();

            const refresh = refreshAllThreads(fakes.ports);
            await vi.waitFor((): void => {
                expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith(REPLACEMENT);
            });
            await rotateIfCapReached(commentOn("t3_full"), fakes.ports);
            releasePublish();
            await refresh;

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith(REPLACEMENT);
        },
    );

    it(
        "leave the thread alone when a comment's rotation runs after another finished",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { fakes } = fullThread();
            await rotateIfCapReached(commentOn("t3_full"), fakes.ports);
            // A comment on the old post, counted before the first rotation retired it, arrives late.
            await rotateIfCapReached(commentOn("t3_full"), fakes.ports);

            expect(fakes.posts.publish).toHaveBeenCalledExactlyOnceWith(REPLACEMENT);
            expect(fakes.threadLocks.unlock).toHaveBeenCalledTimes(fakes.threadLocks.tryLock.mock.calls.length);
        },
    );
});
