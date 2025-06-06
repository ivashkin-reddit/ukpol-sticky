import { CommentCreate } from "@devvit/protos";
import { TriggerContext } from "@devvit/public-api";
import { getCommentCap, refreshPostFromPostId } from "./stickyManager.js";

export async function handleCommentCreate (event: CommentCreate, context: TriggerContext) {
    if (!event.post?.id) {
        console.error("CommentCreate event does not contain a post ID.");
        return;
    }

    if (event.author?.name === context.appName) {
        return; // Ignore comments made by the app itself
    }

    const commentCap = await getCommentCap(event.post.id, context);
    if (!commentCap) {
        return;
    }

    const post = await context.reddit.getPostById(event.post.id);
    if (post.numberOfComments >= commentCap) {
        console.log(`Post ${post.id} has reached the comment cap of ${commentCap}.`);
        await refreshPostFromPostId(event.post.id, context);
    }
}
