import type { AlertLatch, NotifyModerators } from "../notifications/index.js";
import type { ThreadConfig } from "./domain/threadConfig.js";

// What the configuration use cases need from outside the module. Adapters (adapters/) implement these, and the
// composition root (src/composition.ts) wires them.

/** One revision of the config page. */
export interface ConfigPageRevision {
    readonly content: string;
    readonly revisionId: string;
    /** The subreddit whose config page this is, for log messages. */
    readonly subredditName: string;
}

/** The config page: the subreddit wiki page that holds the thread configs. */
export interface ConfigPage {
    /** The page's current revision, or undefined when it cannot be fetched (the adapter logs why). */
    readonly read: () => Promise<ConfigPageRevision | undefined>;
    /** Replaces the page's content and makes the page editable by moderators only. */
    readonly install: (content: string) => Promise<void>;
}

/** The stored thread configs exist but cannot be read; re-saving the config page stores a fresh copy. */
export class UnreadableConfigError extends Error {
    public override readonly name = "UnreadableConfigError";
}

/** What the configuration module keeps between events. */
export interface ConfigStore {
    /**
     * The accepted thread configs, or undefined when none have been stored.
     * Rejects with an UnreadableConfigError when the stored copy cannot be read.
     */
    readonly readConfigs: () => Promise<readonly ThreadConfig[] | undefined>;
    readonly writeConfigs: (configs: readonly ThreadConfig[]) => Promise<void>;
    /** The config page revision whose thread configs were last accepted. */
    readonly readAcceptedRevision: () => Promise<string | undefined>;
    readonly writeAcceptedRevision: (revisionId: string) => Promise<void>;
}

/** Every port the configuration use cases take; each use case declares the subset it uses. */
export interface ConfigurationPorts {
    readonly notifyModerators: NotifyModerators;
    readonly page: ConfigPage;
    readonly store: ConfigStore;
    /** Keeps the alert about an unreadable stored copy to one until fresh thread configs are stored. */
    readonly unreadableAlert: AlertLatch;
}

export type ConfigReadPorts = Pick<ConfigurationPorts, "notifyModerators" | "store" | "unreadableAlert">;
