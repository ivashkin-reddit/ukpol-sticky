import { notifyModerators } from "../notifications/index.js";
import type { NotificationContext } from "../notifications/index.js";
import type { RedisPort } from "../platform/index.js";
import { checkThreadConfigSchema, CONFIG_PAGE } from "./threadConfig.js";
import type { ThreadConfig } from "./threadConfig.js";

// Both keys are live state in every installed subreddit: the accepted thread configs, and whether moderators have
// been alerted that the stored copy is unreadable (storing a fresh copy clears it).
const CONFIG_STORAGE = "Configuration";
const UNREADABLE_CONFIG_ALERT_KEY = "UnreadableConfigAlertSent";

/** The stored thread configs exist but cannot be read; re-saving the config page stores a fresh copy. */
export class UnreadableConfigError extends Error {
    public override readonly name = "UnreadableConfigError";
}

export type ConfigReadContext = NotificationContext & Readonly<{ redis: RedisPort<"del" | "get" | "set"> }>;

export async function storeThreadConfigs(
    context: Readonly<{ redis: RedisPort<"del" | "set"> }>,
    configs: readonly ThreadConfig[],
): Promise<void> {
    await context.redis.set(CONFIG_STORAGE, JSON.stringify(configs));
    // The stored configs are readable again, so a later breakage alerts moderators again.
    await context.redis.del(UNREADABLE_CONFIG_ALERT_KEY);
}

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

/** Sends moderators one alert per broken stored copy; the NX write lets concurrent readers agree on one sender. */
async function alertModeratorsOnce(context: ConfigReadContext, reason: string): Promise<void> {
    const claim = await context.redis.set(UNREADABLE_CONFIG_ALERT_KEY, new Date().toISOString(), { nx: true });
    // Redis answers a declined NX write with nil, which Devvit returns as "".
    if (claim !== "OK") {
        return;
    }

    try {
        await notifyModerators(context, {
            subject: "Sticky Manager cannot read its stored config",
            bodyMarkdown: [
                "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
                `Re-save the wiki page ${CONFIG_PAGE} to store a fresh copy.`,
                `Details: ${reason}`,
            ].join("\n\n"),
        });
    } catch (sendError: unknown) {
        // Release the claim, so the next read retries the alert.
        await context.redis.del(UNREADABLE_CONFIG_ALERT_KEY);
        throw new Error(`Could not alert moderators that the stored config cannot be read (${reason})`, {
            cause: sendError,
        });
    }
}

/**
 * The accepted thread configs, or an empty list when none has been stored yet.
 * A stored copy that cannot be read throws an UnreadableConfigError rather than reading as empty: an empty list means
 * "every thread config removed", and the next refresh would forget every live post. Moderators get one alert asking
 * them to re-save the config page, which stores a fresh, validated copy.
 */
export async function getThreadConfigs(context: ConfigReadContext): Promise<readonly ThreadConfig[]> {
    const stored = await context.redis.get(CONFIG_STORAGE);
    if (stored === undefined) {
        console.warn("No configuration found in storage. Returning empty config.");
        return [];
    }

    try {
        return parseStoredConfigs(stored);
    } catch (error: unknown) {
        if (error instanceof UnreadableConfigError) {
            await alertModeratorsOnce(context, error.message);
        }

        throw error;
    }
}
