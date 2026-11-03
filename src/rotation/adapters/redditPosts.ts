import { T1 as asCommentId, T3 as asPostId } from "@devvit/web/shared";
import type { T1, T3 } from "@devvit/web/shared";
import type { SubredditNamePort } from "../../platform/index.js";
import type { ManagedComment, ManagedPost, Posts } from "../ports.js";

export type RedditPostsContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getCommentById: (id: T1) => Promise<ManagedComment>;
            getPostById: (id: T3) => Promise<ManagedPost>;
            submitPost: (
                options: Readonly<{ subredditName: string; text: string; title: string }>,
            ) => Promise<ManagedPost>;
        }>;
    }>;

/**
 * The subreddit's posts through Devvit's Reddit API. A stored ID that is not a post's (t3_) or comment's (t1_) is
 * rejected before Reddit is called.
 */
export function redditPosts(context: RedditPostsContext): Posts {
    return {
        get: async (postId: string): Promise<ManagedPost> => await context.reddit.getPostById(asPostId(postId)),
        getComment: async (commentId: string): Promise<ManagedComment> =>
            await context.reddit.getCommentById(asCommentId(commentId)),
        publish: async (post: Readonly<{ title: string; body: string }>): Promise<ManagedPost> =>
            await context.reddit.submitPost({
                title: post.title,
                text: post.body,
                subredditName: context.subredditName,
            }),
    };
}
