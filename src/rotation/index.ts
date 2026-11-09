// Rotation: keeps each managed thread's live post current, publishing, rotating and retiring live posts on their
// schedules and at their comment caps. Its use cases take the ports in ports.ts; src/composition.ts wires the adapters.

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
export { forgetDeletedPost, refreshThreadConfig, rotateIfCapReached } from "./rotation.js";
export type { NewComment } from "./rotation.js";
