import type { RedisPort } from "../../platform/index.js";
import { checkThreadConfigSchema } from "../domain/threadConfig.js";
import type { ThreadConfig } from "../domain/threadConfig.js";
import { UnreadableConfigError } from "../ports.js";
import type { ConfigStore } from "../ports.js";

// Live state in every installed subreddit, so these keys stay stable: the accepted thread configs, the config page
// revision they came from, and whether moderators have been alerted that the stored copy is unreadable.
const CONFIG_STORAGE = "Configuration";
const LAST_REVISION_KEY = "LastRevision";
const UNREADABLE_CONFIG_ALERT_KEY = "UnreadableConfigAlertSent";

export type ConfigStoreRedis = RedisPort<"del" | "get" | "set">;

function parseStoredJson(stored: string): unknown {
    try {
        const parsed: unknown = JSON.parse(stored);
        return parsed;
    } catch (error: unknown) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }

        throw new UnreadableConfigError(
            `Stored configuration (Redis key "${CONFIG_STORAGE}") is not JSON: ${error.message}`,
            { cause: error },
        );
    }
}

function parseStoredConfigs(stored: string): readonly ThreadConfig[] {
    const schemaCheck = checkThreadConfigSchema(parseStoredJson(stored));
    if (schemaCheck.kind === "invalid") {
        throw new UnreadableConfigError(
            `Stored configuration (Redis key "${CONFIG_STORAGE}") is invalid: ${schemaCheck.errors}`,
        );
    }

    return schemaCheck.configs;
}

async function readConfigs(redis: ConfigStoreRedis): Promise<readonly ThreadConfig[] | undefined> {
    const stored = await redis.get(CONFIG_STORAGE);
    return stored === undefined ? undefined : parseStoredConfigs(stored);
}

async function claimUnreadableAlert(redis: ConfigStoreRedis): Promise<boolean> {
    // The NX write lets concurrent readers agree on one claimant.
    const claim = await redis.set(UNREADABLE_CONFIG_ALERT_KEY, new Date().toISOString(), { nx: true });
    // Redis answers a declined NX write with nil, which Devvit returns as "".
    return claim === "OK";
}

/** The configuration module's state in the subreddit's Redis. */
export function redisConfigStore(redis: ConfigStoreRedis): ConfigStore {
    return {
        readConfigs: async (): Promise<readonly ThreadConfig[] | undefined> => await readConfigs(redis),
        writeConfigs: async (configs: readonly ThreadConfig[]): Promise<void> => {
            await redis.set(CONFIG_STORAGE, JSON.stringify(configs));
        },
        readAcceptedRevision: async (): Promise<string | undefined> => await redis.get(LAST_REVISION_KEY),
        writeAcceptedRevision: async (revisionId: string): Promise<void> => {
            await redis.set(LAST_REVISION_KEY, revisionId);
        },
        claimUnreadableAlert: async (): Promise<boolean> => await claimUnreadableAlert(redis),
        releaseUnreadableAlert: async (): Promise<void> => {
            await redis.del(UNREADABLE_CONFIG_ALERT_KEY);
        },
    };
}
