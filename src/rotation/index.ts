// Rotation: keeps each managed thread's live post current, publishing, rotating and retiring live posts on their
// schedules and at their comment caps. Its use cases take the ports in ports.ts; src/composition.ts wires the adapters.

export type {
    LivePosts,
    LoadThreadConfigs,
    ManagedComment,
    ManagedPost,
    Posts,
    RefreshJobs,
    RotationPorts,
} from "./ports.js";
export { ensureRefreshPending, requestRefresh, scheduleNextRefresh, startRefreshCheck } from "./refreshSchedule.js";
export { forgetDeletedPost, refreshAllThreads, rotateIfCapReached } from "./rotation.js";
