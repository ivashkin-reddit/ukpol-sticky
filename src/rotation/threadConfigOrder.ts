import { getPin } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { refreshOrder } from "./domain/rotationRules.js";

/** The thread configs in force, in refresh order: enabled ones only, pinned first, otherwise in config page order. */
export function inRefreshOrder(configs: readonly ThreadConfig[]): readonly ThreadConfig[] {
    return refreshOrder(configs, (config: ThreadConfig): boolean => getPin(config).kind !== "none");
}
