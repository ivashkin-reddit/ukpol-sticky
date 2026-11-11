// Changes: the change history, the moderator changes made through the app (who, when and what), kept for the status.
// Other modules record into it through ChangeHistoryStore; src/composition.ts wires the adapter.

export { readLatestChanges } from "./changeHistory.js";
export { KEPT_CHANGES, KEPT_DAYS, keptTitle } from "./domain/changeRules.js";
export type { Change, PinAction, PinChange, PostRef } from "./domain/changeRules.js";
export type { ChangeHistoryStore } from "./ports.js";
