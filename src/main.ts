// Visit developers.reddit.com/docs to learn Devvit!

import { Devvit } from "@devvit/public-api";
import { handleWikiUpdate } from "./config.js";
import { ScheduledJob } from "./constants.js";
import { refreshStickyPosts } from "./stickyManager.js";
import { handleCommentCreate } from "./handleCommentCreate.js";
import { handleAppInstall } from "./installTasks.js";

Devvit.addTrigger({
    event: "ModAction",
    onEvent: handleWikiUpdate,
});

Devvit.addTrigger({
    event: "CommentCreate",
    onEvent: handleCommentCreate,
});

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: handleAppInstall,
});

Devvit.addSchedulerJob({
    name: ScheduledJob.RefreshStickyPosts,
    onRun: refreshStickyPosts,
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
