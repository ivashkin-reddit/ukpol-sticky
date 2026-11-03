// Composition root: registers the app's Devvit triggers and scheduled jobs, each through `observed`.
// Visit developers.reddit.com/docs to learn Devvit.

import { Devvit } from "@devvit/public-api";
import { observed } from "./observed.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME } from "./rotation/adapters/schedulerRefreshJobs.js";
import {
    onAppInstall,
    onAppUpgrade,
    onCommentCreate,
    onModAction,
    onPostDelete,
    onRefreshCheck,
    onRefreshJob,
} from "./triggers.js";

Devvit.addTrigger({ event: "ModAction", onEvent: observed("ModAction trigger", "failures only", onModAction) });
Devvit.addTrigger({
    event: "CommentCreate",
    onEvent: observed("CommentCreate trigger", "failures only", onCommentCreate),
});
Devvit.addTrigger({ event: "PostDelete", onEvent: observed("PostDelete trigger", "failures only", onPostDelete) });
Devvit.addTrigger({ event: "AppInstall", onEvent: observed("AppInstall trigger", "every run", onAppInstall) });
Devvit.addTrigger({ event: "AppUpgrade", onEvent: observed("AppUpgrade trigger", "every run", onAppUpgrade) });
Devvit.addSchedulerJob({ name: REFRESH_JOB_NAME, onRun: observed("Refresh job", "every run", onRefreshJob) });
Devvit.addSchedulerJob({
    name: REFRESH_CHECK_JOB_NAME,
    onRun: observed("Refresh check", "every run", onRefreshCheck),
});

export default Devvit;
