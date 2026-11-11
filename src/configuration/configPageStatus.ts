import { checkConfigPage } from "./configPageCheck.js";
import type { ConfigPageProblem } from "./configPageCheck.js";
import type { ThreadConfig } from "./domain/threadConfig.js";
import { UnreadableConfigError } from "./ports.js";
import type { ConfigPageRevision, ConfigStore, ConfigurationPorts } from "./ports.js";

/**
 * The config page's current revision, as the status shows it. A rejected revision's `problem` is undefined when the
 * checks, changed since, now pass it: saving the page again applies it.
 */
export type ConfigPageState =
    | Readonly<{ kind: "inForce"; savedBy: string | undefined }>
    | Readonly<{ kind: "rejected"; problem: ConfigPageProblem | undefined }>
    | Readonly<{ kind: "unavailable" }>
    | Readonly<{ kind: "unchecked" }>;

/** The stored thread configs, or that they cannot be read. */
export type StoredThreadConfigs =
    Readonly<{ kind: "readable"; configs: readonly ThreadConfig[] }> | Readonly<{ kind: "unreadable" }>;

/** The config page's state and the stored thread configs, as the status shows them. */
export interface ConfigPageStatus {
    readonly page: ConfigPageState;
    readonly threadConfigs: StoredThreadConfigs;
}

export type ConfigStatusPorts = Pick<ConfigurationPorts, "page" | "store">;

/**
 * The stored thread configs, read straight from the store: an unreadable copy is reported here, and the refresh paths
 * alert moderators to it, so the status sends nothing.
 */
async function readStoredThreadConfigs(store: ConfigStore): Promise<StoredThreadConfigs> {
    try {
        return { kind: "readable", configs: (await store.readConfigs()) ?? [] };
    } catch (error: unknown) {
        if (error instanceof UnreadableConfigError) {
            return { kind: "unreadable" };
        }

        throw error;
    }
}

/** What became of `revision`: accepted, rejected (checked again for its problem), or neither yet. */
function describeRevision(
    revision: ConfigPageRevision,
    acceptedRevision: string | undefined,
    rejectedRevision: string | undefined,
): ConfigPageState {
    if (revision.revisionId === acceptedRevision) {
        return { kind: "inForce", savedBy: revision.authorName };
    }

    if (revision.revisionId === rejectedRevision) {
        const check = checkConfigPage(revision.content);
        return { kind: "rejected", problem: check.kind === "invalid" ? check.problem : undefined };
    }

    return { kind: "unchecked" };
}

async function readPageState(ports: ConfigStatusPorts): Promise<ConfigPageState> {
    const acceptedRevision = await ports.store.readAcceptedRevision();
    const rejectedRevision = await ports.store.readRejectedRevision();
    const revision = await ports.page.read();
    return revision === undefined
        ? { kind: "unavailable" }
        : describeRevision(revision, acceptedRevision, rejectedRevision);
}

/**
 * The config page's state and the stored thread configs, for the status. It only reads: it stores nothing and alerts
 * no one.
 */
export async function getConfigPageStatus(ports: ConfigStatusPorts): Promise<ConfigPageStatus> {
    const [page, threadConfigs] = await Promise.all([readPageState(ports), readStoredThreadConfigs(ports.store)]);
    return { page, threadConfigs };
}
