// Rotation: keeps each managed thread's live post current, publishing, rotating and retiring live posts on their
// schedules and at their comment caps, and describes each thread config's state for the status. Its use cases take the
// ports in ports.ts; src/composition.ts wires the adapters.

export type { CheckFinding, NextRefreshReason } from "./domain/refreshRules.js";
export type { AttentionReason } from "./domain/statusRules.js";
export type {
    AppliedThreadConfigs,
    Handover,
    LastRefresh,
    LivePosts,
    LoadThreadConfigs,
    ManagedComment,
    ManagedPost,
    PendingRefresh,
    Posts,
    RefreshJobs,
    RefreshStatus,
    RefreshStatusStore,
    RetiredRefreshRecords,
    RotationPorts,
    ScheduledRefresh,
    ThreadLocks,
} from "./ports.js";
export { checkRefreshes } from "./refreshCheck.js";
export { migrateRefreshRecords } from "./refreshRecordsMigration.js";
export {
    getRefreshStatus,
    requestEveryThreadRefresh,
    scheduleEveryThreadRefresh,
    startRefreshCheck,
} from "./refreshSchedule.js";
export { findManagingThread, holdLivePostLock } from "./managedPosts.js";
export type { ManagingThread } from "./managedPosts.js";
export { forgetDeletedPost, refreshThreadConfig, rotateIfCapReached } from "./rotation.js";
export type { NewComment } from "./rotation.js";
export { findLivePostLink, getThreadStatuses, needsAttention } from "./threadStatus.js";
export type {
    LivePostLink,
    LivePostStatus,
    ReadableThreadStatus,
    StatusPorts,
    ThreadStatus,
    ThreadStatuses,
} from "./threadStatus.js";
