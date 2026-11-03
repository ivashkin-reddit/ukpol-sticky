import { describe, expect, it, vi } from "vitest";
import { createFakePost, createFakeStickyContext } from "../tests/support/fakeStickyContext.js";
import type { FakeStickyContext } from "../tests/support/fakeStickyContext.js";
import { handleCommentCreate } from "./handleCommentCreate.js";
import type { CommentCreateContext, CommentCreateEvent } from "./handleCommentCreate.js";
import { getCommentCap, refreshPostFromPostId } from "./stickyManager.js";
import type * as StickyManager from "./stickyManager.js";

vi.mock(import("./stickyManager.js"), (): Partial<typeof StickyManager> => ({
    getCommentCap: vi.fn<typeof getCommentCap>(),
    refreshPostFromPostId: vi.fn<typeof refreshPostFromPostId>(),
}));

const TEST_OPTIONS = { timeout: 1000 };
const APP_SLUG = "ukpol-sticky";

interface CommentFakes {
    readonly context: CommentCreateContext;
    readonly sticky: FakeStickyContext;
}

function createCommentFakes (): CommentFakes {
    const sticky = createFakeStickyContext();
    return { context: { ...sticky.context, appSlug: APP_SLUG }, sticky };
}

function postWithComments (numberOfComments: number): ReturnType<typeof createFakePost> {
    return createFakePost({ body: "Body", createdAt: new Date("2026-04-21T10:00:00Z"), id: "t3_alpha", numberOfComments, stickied: true });
}

describe(handleCommentCreate, (): void => {
    it.for<CommentCreateEvent>([{}, { post: { id: "" } }])("logs and stops when the event has no post id (%j)", TEST_OPTIONS, async (event: CommentCreateEvent): Promise<void> => {
        expect.assertions(3);

        const errorSpy = vi.spyOn(console, "error").mockImplementation((): undefined => undefined);
        const fakes = createCommentFakes();
        await handleCommentCreate(event, fakes.context);

        expect(errorSpy).toHaveBeenCalledExactlyOnceWith("CommentCreate event does not contain a post ID.");
        expect(vi.mocked(getCommentCap)).not.toHaveBeenCalled();
        expect(fakes.sticky.reddit.getPostById).not.toHaveBeenCalled();
    });

    it("ignores the app's own comments", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createCommentFakes();
        await handleCommentCreate({ author: { name: APP_SLUG }, post: { id: "t3_alpha" } }, fakes.context);

        expect(vi.mocked(getCommentCap)).not.toHaveBeenCalled();
        expect(fakes.sticky.reddit.getPostById).not.toHaveBeenCalled();
    });

    it("stops before fetching the post when no comment cap is stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createCommentFakes();
        vi.mocked(getCommentCap).mockResolvedValue(undefined);
        await handleCommentCreate({ post: { id: "t3_alpha" } }, fakes.context);

        expect(vi.mocked(getCommentCap)).toHaveBeenCalledExactlyOnceWith("t3_alpha", fakes.context);
        expect(fakes.sticky.reddit.getPostById).not.toHaveBeenCalled();
    });

    it("leaves a post below its comment cap alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createCommentFakes();
        vi.mocked(getCommentCap).mockResolvedValue(100);
        fakes.sticky.reddit.getPostById.mockResolvedValue(postWithComments(99).post);
        await handleCommentCreate({ post: { id: "t3_alpha" } }, fakes.context);

        expect(fakes.sticky.reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_alpha");
        expect(vi.mocked(refreshPostFromPostId)).not.toHaveBeenCalled();
    });

    it("refreshes a post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createCommentFakes();
        vi.mocked(getCommentCap).mockResolvedValue(100);
        fakes.sticky.reddit.getPostById.mockResolvedValue(postWithComments(100).post);
        await handleCommentCreate({ post: { id: "t3_alpha" } }, fakes.context);

        expect(vi.mocked(refreshPostFromPostId)).toHaveBeenCalledExactlyOnceWith("t3_alpha", fakes.context);
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("Post t3_alpha has reached the comment cap of 100.");
    });
});
