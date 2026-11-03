// Thread configuration: moderators define their managed threads on the config page; this module checks, stores and
// serves those thread configs.

export { installConfigPage } from "./configPageInstall.js";
export type { ConfigPageInstallContext } from "./configPageInstall.js";
export { applyConfigPageRevision } from "./configPageRevision.js";
export type { ConfigPageOutcome, ConfigPageRevisionContext } from "./configPageRevision.js";
export { getThreadConfigs, storeThreadConfigs, UnreadableConfigError } from "./configStore.js";
export type { ConfigReadContext } from "./configStore.js";
export { getSchedule } from "./threadConfig.js";
export type { Schedule, ThreadConfig } from "./threadConfig.js";
export { renderTitle } from "./titleTemplate.js";
