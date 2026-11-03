import type { RedisPort } from "../../platform/index.js";
import { checkThreadConfigSchema } from "../domain/threadConfig.js";
import type { ThreadConfig } from "../domain/threadConfig.js";
import { UnreadableConfigError } from "../ports.js";
import type { ConfigStore } from "../ports.js";

// Live state in every installed subreddit, so these keys stay stable: the accepted thread configs, and the config page
// revision they came from.
const CONFIG_STORAGE = "Configuration";
const LAST_REVISION_KEY = "LastRevision";

export type ConfigStoreRedis = RedisPort<"get" | "set">;

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
    };
}
