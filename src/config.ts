import type { TriggerContext } from "@devvit/public-api";
import { asT5ID } from "@devvit/public-api/types/tid.js";
import { Ajv } from "ajv";
import type { JSONSchemaType } from "ajv";
import type { RedisPort } from "./ports.js";

export const CONFIG_PAGE = "stickymgr/config";
const CONFIG_STORAGE = "Configuration";
// Set while moderators have been alerted that the stored config is unreadable; storing a fresh config clears it.
const UNREADABLE_CONFIG_ALERT_KEY = "UnreadableConfigAlertSent";

// Sundays first, so each weekly frequency's index is its getUTCDay() value.
export const WEEKLY_FREQUENCIES = [
    "sundays",
    "mondays",
    "tuesdays",
    "wednesdays",
    "thursdays",
    "fridays",
    "saturdays",
] as const;
export const SCHEDULE_FREQUENCIES = ["daily", ...WEEKLY_FREQUENCIES] as const;
export type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

// HH:mm, 24-hour, interpreted as UTC.
const POST_TIME = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/u;

/**
 * One managed post: a YAML document on the config wiki page.
 * A key left empty in YAML parses as null, and ajv's JSONSchemaType admits null for optional properties, so those
 * keys are typed `| null` — except `frequency`, whose enum does not include null.
 */
export interface Config {
    readonly name: string;
    readonly enabled: boolean;
    readonly title: string;
    readonly frequency?: ScheduleFrequency;
    readonly postTime?: string | null;
    readonly sticky?: boolean | null;
    readonly maxComments: number;
    readonly body: string;
    readonly endNote?: string | null;
    readonly lockOnRefresh?: boolean | null;
}

const configSchema: JSONSchemaType<Config[]> = {
    type: "array",
    items: {
        type: "object",
        properties: {
            name: { type: "string" },
            enabled: { type: "boolean" },
            title: { type: "string" },
            frequency: { type: "string", enum: [...SCHEDULE_FREQUENCIES], nullable: true },
            postTime: { type: "string", pattern: POST_TIME.source, nullable: true },
            sticky: { type: "boolean", nullable: true },
            maxComments: { type: "integer", minimum: 1 },
            body: { type: "string" },
            endNote: { type: "string", nullable: true },
            lockOnRefresh: { type: "boolean", nullable: true },
        },
        required: ["name", "enabled", "title", "maxComments", "body"],
        additionalProperties: false,
    },
};

const ajv = new Ajv();
const validateConfigs = ajv.compile(configSchema);

export type ConfigValidation =
    Readonly<{ kind: "invalid"; errors: string }> | Readonly<{ kind: "valid"; configs: readonly Config[] }>;

export function validateConfigList(values: unknown): ConfigValidation {
    if (!validateConfigs(values)) {
        return { kind: "invalid", errors: ajv.errorsText(validateConfigs.errors) };
    }

    return { kind: "valid", configs: values };
}

export interface PostTime {
    readonly hours: number;
    readonly minutes: number;
}

/** Throws if `postTime` is not HH:mm; configs that passed validation always are. */
export function parsePostTime(postTime: string): PostTime {
    const groups = POST_TIME.exec(postTime)?.groups;
    const hours = groups?.["hours"];
    const minutes = groups?.["minutes"];
    if (hours === undefined || minutes === undefined) {
        throw new RangeError(`postTime "${postTime}" is not in HH:mm format.`);
    }

    return { hours: Number(hours), minutes: Number(minutes) };
}

/** The stored config exists but cannot be read; re-saving the wiki page stores a fresh one. */
export class UnreadableConfigError extends Error {
    public override readonly name = "UnreadableConfigError";
}

export type ConfigReadContext = Readonly<{
    redis: RedisPort<"del" | "get" | "set">;
    reddit: Readonly<{ modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "createModInboxConversation">> }>;
    subredditId: string;
}>;

export async function storeConfig(
    context: Readonly<{ redis: RedisPort<"del" | "set"> }>,
    configs: readonly Config[],
): Promise<void> {
    await context.redis.set(CONFIG_STORAGE, JSON.stringify(configs));
    // The stored config is readable again, so a later breakage alerts moderators again.
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

function parseStoredConfig(stored: string): readonly Config[] {
    const validation = validateConfigList(parseStoredJson(stored));
    if (validation.kind === "invalid") {
        throw new UnreadableConfigError(
            `Stored configuration (Redis key "${CONFIG_STORAGE}") is invalid: ${validation.errors}`,
        );
    }

    return validation.configs;
}

/** Sends moderators one modmail per broken stored config; the NX write lets concurrent readers agree on one sender. */
async function alertModeratorsOnce(context: ConfigReadContext, reason: string): Promise<void> {
    const claim = await context.redis.set(UNREADABLE_CONFIG_ALERT_KEY, new Date().toISOString(), { nx: true });
    // Redis answers a declined NX write with nil, which Devvit returns as "".
    if (claim !== "OK") {
        return;
    }

    try {
        await context.reddit.modMail.createModInboxConversation({
            subredditId: asT5ID(context.subredditId),
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
 * The stored configs, or an empty list when none has been stored yet.
 * A stored config that cannot be read throws rather than reading as empty: callers treat an empty list as "every
 * config was removed" and forget all tracked posts. Moderators get one modmail asking them to re-save the wiki page,
 * which stores a fresh, validated config.
 */
export async function getConfig(context: ConfigReadContext): Promise<readonly Config[]> {
    const stored = await context.redis.get(CONFIG_STORAGE);
    if (stored === undefined) {
        console.warn("No configuration found in storage. Returning empty config.");
        return [];
    }

    try {
        return parseStoredConfig(stored);
    } catch (error: unknown) {
        if (error instanceof UnreadableConfigError) {
            await alertModeratorsOnce(context, error.message);
        }

        throw error;
    }
}
