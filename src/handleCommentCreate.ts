import { refreshPostFromPostId } from "./stickyManager.js";
import type { StickyContext } from "./stickyManager.js";
import { getCommentCap } from "./trackedPosts.js";

export type CommentCreateEvent = Readonly<{
    author?: Readonly<{ name: string }> | undefined;
    post?: Readonly<{ id: string }> | undefined;
}>;

export type CommentCreateContext = StickyContext & Readonly<{ appSlug: string }>;

/** The commented post's ID, or undefined when the comment cannot count towards a cap. */
function getCountedPostId(event: CommentCreateEvent, appSlug: string): string | undefined {
    // Protobuf fields default to "", so an empty ID means the post is missing.
    const postId = event.post?.id ?? "";
    if (postId === "") {
        console.error("CommentCreate event does not contain a post ID.");
        return undefined;
    }

    // The app's own comments (end notes on retired posts) never count towards a cap.
    return event.author?.name === appSlug ? undefined : postId;
}

export async function handleCommentCreate(event: CommentCreateEvent, context: CommentCreateContext): Promise<void> {
    const postId = getCountedPostId(event, context.appSlug);
    if (postId === undefined) {
        return;
    }

    const commentCap = await getCommentCap(postId, context);
    if (commentCap === undefined) {
        return;
    }

    const post = await context.reddit.getPostById(postId);
    if (post.numberOfComments >= commentCap) {
        console.log(`Post ${post.id} has reached the comment cap of ${String(commentCap)}.`);
        await refreshPostFromPostId(postId, context);
    }
}
