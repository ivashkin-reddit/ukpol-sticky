// Rotation: keeps each managed thread's live post current, publishing, rotating and retiring live posts on their
// schedules and at their comment caps.

export { forgetDeletedPost } from "./livePosts.js";
export type { LivePostCleanupContext } from "./livePosts.js";
export { REFRESH_JOB_NAME, requestRefresh } from "./refreshJob.js";
export type { RefreshJobContext } from "./refreshJob.js";
export { refreshAllThreads, rotateIfCapReached, scheduleNextRefresh } from "./rotation.js";
export type { ManagedComment, ManagedPost, PublishContext, RotationContext } from "./rotation.js";
