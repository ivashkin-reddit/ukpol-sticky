import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { createFakePost } from "../../../tests/support/fakePosts.js";
import { redditPosts } from "./redditPosts.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const POST = createFakePost({
    body: "Body",
    createdAt: new Date("2026-04-21T10:00:00Z"),
    id: "t3_alpha",
    numberOfComments: 0,
    stickied: false,
}).post;

describe(redditPosts, (): void => {
    it("publishes to the subreddit the context names", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeDevvitContext("ukpolitics");
        fakes.reddit.submitPost.mockResolvedValue(POST);

        await expect(redditPosts(fakes.context).publish({ title: "Title", body: "Body" })).resolves.toBe(POST);
        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({
            title: "Title",
            text: "Body",
            subredditName: "ukpolitics",
        });
        expect(fakes.reddit.getCurrentSubredditName).not.toHaveBeenCalled();
    });

    it("publishes to the current subreddit when the context names none", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeDevvitContext();
        fakes.reddit.submitPost.mockResolvedValue(POST);

        await redditPosts(fakes.context).publish({ title: "Title", body: "Body" });

        expect(fakes.reddit.getCurrentSubredditName).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({
            title: "Title",
            text: "Body",
            subredditName: "currentsub",
        });
    });

    it("gets a post by its ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeDevvitContext();
        fakes.reddit.getPostById.mockResolvedValue(POST);

        await expect(redditPosts(fakes.context).get("t3_alpha")).resolves.toBe(POST);
        expect(fakes.reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_alpha");
    });

    it("reads a comment by its ID", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeDevvitContext();
        const { comment } = createFakePost({
            body: "Body",
            createdAt: new Date("2026-04-21T10:00:00Z"),
            id: "t3_alpha",
            numberOfComments: 1,
            stickied: false,
        });
        fakes.reddit.getCommentById.mockResolvedValue(comment);

        await expect(redditPosts(fakes.context).getComment("t1_alpha")).resolves.toBe(comment);
        expect(fakes.reddit.getCommentById).toHaveBeenCalledExactlyOnceWith("t1_alpha");
    });
});
