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
}).post;

describe(redditPosts, (): void => {
    it("publishes to the subreddit the context names", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeDevvitContext("ukpolitics");
        fakes.reddit.submitPost.mockResolvedValue(POST);

        await expect(redditPosts(fakes.context).publish({ title: "Title", body: "Body" })).resolves.toBe(POST);
        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({
            title: "Title",
            text: "Body",
            subredditName: "ukpolitics",
        });
    });

    it(
        "rejects a stored ID that is not a post's or a comment's before calling Reddit",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeDevvitContext();
            const posts = redditPosts(fakes.context);

            await expect(posts.get("t1_beta")).rejects.toThrow("Expected link id to start with t3_, got t1_beta");
            await expect(posts.getComment("t3_alpha")).rejects.toThrow(
                "Expected comment id to start with t1_, got t3_alpha",
            );
            expect(fakes.reddit.getPostById).not.toHaveBeenCalled();
        },
    );

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
        });
        fakes.reddit.getCommentById.mockResolvedValue(comment);

        await expect(redditPosts(fakes.context).getComment("t1_alpha")).resolves.toBe(comment);
        expect(fakes.reddit.getCommentById).toHaveBeenCalledExactlyOnceWith("t1_alpha");
    });
});
