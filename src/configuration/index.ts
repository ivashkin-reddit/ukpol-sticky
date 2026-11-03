// Thread configuration: moderators define their managed threads on the config page; this module checks, stores and
// serves those thread configs. Its use cases take the ports in ports.ts; src/composition.ts wires the adapters.

export { installConfigPage } from "./configPageInstall.js";
export { applyConfigPageRevision } from "./configPageRevision.js";
export type { ConfigPageOutcome } from "./configPageRevision.js";
export { getSchedule } from "./domain/threadConfig.js";
export type { Schedule, ThreadConfig } from "./domain/threadConfig.js";
export { renderTitle } from "./domain/titleTemplate.js";
export { UnreadableConfigError } from "./ports.js";
export type { ConfigPage, ConfigPageRevision, ConfigReadPorts, ConfigStore, ConfigurationPorts } from "./ports.js";
export { getThreadConfigs, storeThreadConfigs } from "./storedConfigs.js";
