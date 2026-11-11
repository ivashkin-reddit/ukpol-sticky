import type { Change } from "./domain/changeRules.js";

// What the changes use cases need from outside the module. Adapters (adapters/) implement these, and the composition
// root (src/composition.ts) wires them.

/** Where the change history is kept. Adding a change also drops those no longer kept. */
export interface ChangeHistoryStore {
    readonly add: (change: Change) => Promise<void>;
    /** Every stored change, in no particular order; an entry that cannot be read is skipped. */
    readonly all: () => Promise<readonly Change[]>;
}
