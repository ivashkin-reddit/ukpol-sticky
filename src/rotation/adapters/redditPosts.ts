import { getSubredditName } from "../../platform/index.js";
import type { SubredditNamePort } from "../../platform/index.js";
import type { ManagedPost, Posts } from "../ports.js";

export type RedditPostsContext = SubredditNamePort &
    Readonly<{
        reddit: Readonly<{
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
        publish: async (post: Readonly<{ title: string; body: string }>): Promise<ManagedPost> =>
            await context.reddit.submitPost({
                title: post.title,
                text: post.body,
                subredditName: await getSubredditName(context),
            }),
    };
}
