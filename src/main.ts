// Composition root: registers the app's Devvit triggers and scheduled job. Visit developers.reddit.com/docs to learn Devvit.

import { Devvit } from "@devvit/public-api";
import { REFRESH_JOB_NAME } from "./rotation/index.js";
import { onAppInstall, onAppUpgrade, onCommentCreate, onModAction, onPostDelete, onRefreshJob } from "./triggers.js";

Devvit.addTrigger({ event: "ModAction", onEvent: onModAction });
Devvit.addTrigger({ event: "CommentCreate", onEvent: onCommentCreate });
Devvit.addTrigger({ event: "PostDelete", onEvent: onPostDelete });
Devvit.addTrigger({ event: "AppInstall", onEvent: onAppInstall });
Devvit.addTrigger({ event: "AppUpgrade", onEvent: onAppUpgrade });
Devvit.addSchedulerJob({ name: REFRESH_JOB_NAME, onRun: onRefreshJob });

export default Devvit;
