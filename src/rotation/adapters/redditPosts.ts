import { getSubredditName } from "../../platform/index.js";
import type { SubredditNamePort } from "../../platform/index.js";
import type { ManagedComment, ManagedPost, Posts } from "../ports.js";

export type RedditPostsContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
            getCommentById: (id: string) => Promise<ManagedComment>;
            getPostById: (id: string) => Promise<ManagedPost>;
            submitPost: (
                options: Readonly<{ subredditName: string; text: string; title: string }>,
            ) => Promise<ManagedPost>;
        }>;
    }>;

/** The subreddit's posts through Devvit's Reddit API. */
export function redditPosts(context: RedditPostsContext): Posts {
    return {
        get: async (postId: string): Promise<ManagedPost> => await context.reddit.getPostById(postId),
        getComment: async (commentId: string): Promise<ManagedComment> =>
            await context.reddit.getCommentById(commentId),
        publish: async (post: Readonly<{ title: string; body: string }>): Promise<ManagedPost> =>
            await context.reddit.submitPost({
                title: post.title,
                text: post.body,
                subredditName: await getSubredditName(context),
            }),
    };
}
