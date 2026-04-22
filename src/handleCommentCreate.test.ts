import { afterEach, vi } from "vitest";

vi.mock("./stickyManager.js", () => ({
    getCommentCap: vi.fn(),
    refreshPostFromPostId: vi.fn(),
}));

import { handleCommentCreate } from "./handleCommentCreate.js";
import { getCommentCap, refreshPostFromPostId } from "./stickyManager.js";

const mockedGetCommentCap = vi.mocked(getCommentCap);
const mockedRefreshPostFromPostId = vi.mocked(refreshPostFromPostId);

afterEach(() => {
    vi.restoreAllMocks();
    mockedGetCommentCap.mockReset();
    mockedRefreshPostFromPostId.mockReset();
});

function createContext () {
    return {
        appSlug: "ukpol-sticky",
        reddit: {
            getPostById: vi.fn(),
        },
    };
}

test("handleCommentCreate logs and returns when the event has no post id", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const context = createContext();

    await handleCommentCreate({}, context as never);

    expect(errorSpy).toHaveBeenCalledWith("CommentCreate event does not contain a post ID.");
    expect(mockedGetCommentCap).not.toHaveBeenCalled();
    expect(context.reddit.getPostById).not.toHaveBeenCalled();
    expect(mockedRefreshPostFromPostId).not.toHaveBeenCalled();
});

test("handleCommentCreate ignores comments made by the app", async () => {
    const context = createContext();

    await handleCommentCreate({
        author: { name: "ukpol-sticky" },
        post: { id: "t3_alpha" },
    } as never, context as never);

    expect(mockedGetCommentCap).not.toHaveBeenCalled();
    expect(context.reddit.getPostById).not.toHaveBeenCalled();
    expect(mockedRefreshPostFromPostId).not.toHaveBeenCalled();
});

test("handleCommentCreate returns before fetching the post when no comment cap is stored", async () => {
    const context = createContext();
    mockedGetCommentCap.mockResolvedValue(undefined);

    await handleCommentCreate({
        post: { id: "t3_alpha" },
    } as never, context as never);

    expect(mockedGetCommentCap).toHaveBeenCalledWith("t3_alpha", context);
    expect(context.reddit.getPostById).not.toHaveBeenCalled();
    expect(mockedRefreshPostFromPostId).not.toHaveBeenCalled();
});

test("handleCommentCreate does not refresh when the post is below the comment cap", async () => {
    const context = createContext();
    mockedGetCommentCap.mockResolvedValue(100);
    context.reddit.getPostById.mockResolvedValue({
        id: "t3_alpha",
        numberOfComments: 99,
    });

    await handleCommentCreate({
        post: { id: "t3_alpha" },
    } as never, context as never);

    expect(mockedGetCommentCap).toHaveBeenCalledWith("t3_alpha", context);
    expect(context.reddit.getPostById).toHaveBeenCalledWith("t3_alpha");
    expect(mockedRefreshPostFromPostId).not.toHaveBeenCalled();
});

test("handleCommentCreate refreshes when the post reaches the stored comment cap", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const context = createContext();
    mockedGetCommentCap.mockResolvedValue(100);
    context.reddit.getPostById.mockResolvedValue({
        id: "t3_alpha",
        numberOfComments: 100,
    });

    await handleCommentCreate({
        post: { id: "t3_alpha" },
    } as never, context as never);

    expect(mockedGetCommentCap).toHaveBeenCalledWith("t3_alpha", context);
    expect(context.reddit.getPostById).toHaveBeenCalledWith("t3_alpha");
    expect(mockedRefreshPostFromPostId).toHaveBeenCalledWith("t3_alpha", context);
    expect(logSpy).toHaveBeenCalled();
});
