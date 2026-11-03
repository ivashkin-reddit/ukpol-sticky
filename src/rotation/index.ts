// Rotation: keeps each managed thread's live post current, publishing, rotating and retiring live posts on their
// schedules and at their comment caps. Its use cases take the ports in ports.ts; src/composition.ts wires the adapters.

export type {
    LastRefresh,
    LivePosts,
    LoadThreadConfigs,
    ManagedComment,
    ManagedPost,
    Posts,
    RefreshJobs,
    RefreshStatus,
    RefreshStatusStore,
    RotationPorts,
    ThreadLocks,
} from "./ports.js";
export {
    ensureRefreshPending,
    getRefreshStatus,
    requestRefresh,
    scheduleNextRefresh,
    startRefreshCheck,
} from "./refreshSchedule.js";
export { forgetDeletedPost, refreshAllThreads, rotateIfCapReached } from "./rotation.js";
