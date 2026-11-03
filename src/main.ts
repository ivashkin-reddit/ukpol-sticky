// Visit developers.reddit.com/docs to learn Devvit!

import { Devvit } from "@devvit/public-api";
import { REFRESH_STICKY_POSTS_JOB } from "./constants.js";
import { handleCommentCreate } from "./handleCommentCreate.js";
import { handleAppInstall, handleAppUpgrade } from "./installTasks.js";
import { handlePostDelete, refreshStickyPosts } from "./stickyManager.js";
import { handleWikiUpdate } from "./wikiConfig.js";

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleWikiUpdate,
});

Devvit.addTrigger({
    event: "CommentCreate",
    onEvent: handleCommentCreate,
});

Devvit.addTrigger({
    event: "PostDelete",
    onEvent: handlePostDelete,
});

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleAppInstall,
});

Devvit.addTrigger({
    event: "AppUpgrade",
    onEvent: handleAppUpgrade,
});

Devvit.addSchedulerJob({
    name: REFRESH_STICKY_POSTS_JOB,
    onRun: refreshStickyPosts,
});

export default Devvit;
