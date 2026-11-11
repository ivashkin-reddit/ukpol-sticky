import { Ajv } from "ajv";
import type { JSONSchemaType } from "ajv";
import { format } from "date-fns";
import { uniq } from "lodash";
import { findDateToken, renderTitle } from "./titleTemplate.js";

/** The wiki page that holds the thread configs. */
export const CONFIG_PAGE = "stickymgr/config";

// Sundays first, so each weekly frequency's index is its getUTCDay() value.
const WEEKLY_FREQUENCIES = [
    "sundays",
    "mondays",
    "tuesdays",
    "wednesdays",
    "thursdays",
    "fridays",
    "saturdays",
] as const;
const SCHEDULE_FREQUENCIES = ["daily", ...WEEKLY_FREQUENCIES] as const;
type ScheduleFrequency = (typeof SCHEDULE_FREQUENCIES)[number];

// HH:mm, 24-hour, interpreted as UTC.
const POST_TIME = /^(?<hours>[01]\d|2[0-3]):(?<minutes>[0-5]\d)$/v;

// Any instant will do: a date-fns format string is valid or not regardless of the date it formats.
const ANY_INSTANT = 0;

// Reddit's limits, in characters, on what the app writes from a thread config. A thread config's name also appears in
// alert subjects, which modmail caps at 100 characters.
const MAX_NAME_LENGTH = 64;
const MAX_TITLE_LENGTH = 300;
const MAX_BODY_LENGTH = 40_000;
const MAX_END_NOTE_LENGTH = 10_000;

/** Reddit's community highlights hold six posts, so a thread config's slot is 1 to 6. */
export const MAX_SLOT = 6;

/**
 * One moderator-written definition of a managed thread: a YAML document on the config page.
 * A key left empty in YAML parses as null, and ajv's JSONSchemaType admits null for optional properties, so those
 * keys are typed `| null` — except `frequency`, whose enum does not include null.
 */
export interface ThreadConfig {
    readonly name: string;
    readonly enabled: boolean;
    readonly title: string;
    readonly frequency?: ScheduleFrequency;
    readonly postTime?: string | null;
    readonly sticky?: boolean | null;
    readonly slot?: number | null;
    readonly maxComments: number;
    readonly body: string;
    readonly endNote?: string | null;
    readonly lockOnRefresh?: boolean | null;
}

const threadConfigsSchema: JSONSchemaType<ThreadConfig[]> = {
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
            slot: { type: "integer", minimum: 1, maximum: MAX_SLOT, nullable: true },
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
const matchesSchema = ajv.compile(threadConfigsSchema);

export type SchemaCheck =
    Readonly<{ kind: "invalid"; errors: string }> | Readonly<{ kind: "valid"; configs: readonly ThreadConfig[] }>;

/** Checks only the shape of a list of thread configs, as stored or as parsed from the config page. */
export function checkThreadConfigSchema(values: unknown): SchemaCheck {
    if (!matchesSchema(values)) {
        return { kind: "invalid", errors: ajv.errorsText(matchesSchema.errors) };
    }

    return { kind: "valid", configs: values };
}

/**
 * Where a thread config's live posts are pinned: in its slot; in the slot the previous live post held (`sticky: true`
 * without a slot); or not at all.
 */
export type Pin =
    Readonly<{ kind: "keepSlot" }> | Readonly<{ kind: "none" }> | Readonly<{ kind: "slot"; slot: number }>;

export function getPin(config: ThreadConfig): Pin {
    if (config.slot != null) {
        return { kind: "slot", slot: config.slot };
    }

    return config.sticky === true ? { kind: "keepSlot" } : { kind: "none" };
}

/** A reason a config page cannot be accepted. */
export type ConfigProblem =
    | Readonly<{ kind: "duplicateNames" }>
    | Readonly<{ kind: "incompleteSchedule"; configName: string }>
    | Readonly<{ kind: "invalidDateFormat"; configName: string; dateFormat: string; cause: Readonly<RangeError> }>
    | Readonly<{ kind: "invalidSchema"; errors: string }>
    | Readonly<{ kind: "invalidValue"; configName: string; reason: string }>
    | Readonly<{ kind: "sharedSlot"; slot: number; configNames: readonly [string, string] }>
    | Readonly<{ kind: "tooManyPinned"; count: number }>;

export type ThreadConfigsCheck =
    | Readonly<{ kind: "invalid"; problem: ConfigProblem }>
    | Readonly<{ kind: "valid"; configs: readonly ThreadConfig[] }>;

/** A name that could not key a thread config's records, or would not fit in an alert subject. */
function checkName(config: ThreadConfig): ConfigProblem | undefined {
    const { name } = config;
    const configName = name.length > MAX_NAME_LENGTH ? `${name.slice(0, MAX_NAME_LENGTH)}…` : name;
    if (name.trim() === "") {
        return { kind: "invalidValue", configName, reason: "its name is empty" };
    }

    // Live posts are kept in a record keyed by name, where these names would read the record's own properties.
    if (name in Object.prototype) {
        return { kind: "invalidValue", configName, reason: "its name is reserved" };
    }

    return name.length > MAX_NAME_LENGTH
        ? { kind: "invalidValue", configName, reason: `its name is longer than ${String(MAX_NAME_LENGTH)} characters` }
        : undefined;
}

/** Text that Reddit would refuse to publish. Runs after checkDateToken, since rendering needs a valid date token. */
function checkText(config: ThreadConfig): ConfigProblem | undefined {
    const title = renderTitle(config.title, new Date(ANY_INSTANT));
    const reasons: readonly (readonly [boolean, string])[] = [
        [title.trim() === "", "its title is empty"],
        [
            Math.max(config.title.length, title.length) > MAX_TITLE_LENGTH,
            `its title is longer than Reddit's limit of ${String(MAX_TITLE_LENGTH)} characters`,
        ],
        [
            config.body.length > MAX_BODY_LENGTH,
            `its body is longer than Reddit's limit of ${MAX_BODY_LENGTH.toLocaleString("en")} characters`,
        ],
        [
            (config.endNote ?? "").length > MAX_END_NOTE_LENGTH,
            `its end note is longer than Reddit's limit of ${MAX_END_NOTE_LENGTH.toLocaleString("en")} characters for a comment`,
        ],
    ];
    const reason = reasons.find(([applies]: readonly [boolean, string]): boolean => applies)?.[1];
    return reason === undefined ? undefined : { kind: "invalidValue", configName: config.name, reason };
}

function checkSchedulePair(config: ThreadConfig): ConfigProblem | undefined {
    const hasFrequency = config.frequency !== undefined;
    const hasPostTime = config.postTime != null;
    return hasFrequency === hasPostTime ? undefined : { kind: "incompleteSchedule", configName: config.name };
}

function checkDateToken(config: ThreadConfig): ConfigProblem | undefined {
    const token = findDateToken(config.title);
    if (token === undefined) {
        return undefined;
    }

    try {
        format(ANY_INSTANT, token.dateFormat);
        return undefined;
    } catch (error: unknown) {
        // date-fns reports an unusable format string with a RangeError; anything else is a fault, not a config problem.
        if (!(error instanceof RangeError)) {
            throw error;
        }

        return { kind: "invalidDateFormat", configName: config.name, dateFormat: token.dateFormat, cause: error };
    }
}

/** A slot asks for pinning, so it cannot stand beside sticky turned off. */
function checkSlot(config: ThreadConfig): ConfigProblem | undefined {
    return config.slot != null && config.sticky === false
        ? { kind: "invalidValue", configName: config.name, reason: "it sets a slot but turns sticky off" }
        : undefined;
}

/**
 * Each slot belongs to one enabled thread config, and Reddit holds six highlights, so at most six enabled thread
 * configs are pinned: a seventh would unpin another at every rotation.
 */
function checkPins(configs: readonly ThreadConfig[]): ConfigProblem | undefined {
    const pinned = configs.filter((config): boolean => config.enabled && getPin(config).kind !== "none");
    const bySlot = new Map<number, string>();
    for (const config of pinned) {
        if (config.slot != null) {
            const earlier = bySlot.get(config.slot);
            if (earlier !== undefined) {
                return { kind: "sharedSlot", slot: config.slot, configNames: [earlier, config.name] };
            }

            bySlot.set(config.slot, config.name);
        }
    }

    return pinned.length > MAX_SLOT ? { kind: "tooManyPinned", count: pinned.length } : undefined;
}

/**
 * Checks values parsed from the config page: the schema, then each thread config's name, schedule, date token, text
 * and slot in page order, then that names are unique, then the pins. The first problem found is the one reported.
 * These checks apply only to a config page being saved; a stored copy is checked against the schema alone, so it stays
 * readable.
 */
function firstConfigProblem(configs: readonly ThreadConfig[]): ConfigProblem | undefined {
    for (const config of configs) {
        const problem =
            checkName(config) ??
            checkSchedulePair(config) ??
            checkDateToken(config) ??
            checkText(config) ??
            checkSlot(config);
        if (problem !== undefined) {
            return problem;
        }
    }

    const namesAreUnique = uniq(configs.map((config): string => config.name)).length === configs.length;
    return namesAreUnique ? checkPins(configs) : { kind: "duplicateNames" };
}

export function checkThreadConfigs(values: readonly unknown[]): ThreadConfigsCheck {
    const schemaCheck = checkThreadConfigSchema(values);
    if (schemaCheck.kind === "invalid") {
        return { kind: "invalid", problem: { kind: "invalidSchema", errors: schemaCheck.errors } };
    }

    const problem = firstConfigProblem(schemaCheck.configs);
    return problem === undefined ? schemaCheck : { kind: "invalid", problem };
}

/** When a thread config's live post is due for rotation by time: daily, or weekly on a day, at a UTC time. */
export type Schedule =
    | Readonly<{ kind: "daily"; hours: number; minutes: number }>
    // `weekday` counts from Sunday = 0, as Date.prototype.getUTCDay() does.
    | Readonly<{ kind: "weekly"; weekday: number; hours: number; minutes: number }>;

function parsePostTime(postTime: string): Readonly<{ hours: number; minutes: number }> {
    const groups = POST_TIME.exec(postTime)?.groups;
    const hours = groups?.["hours"];
    const minutes = groups?.["minutes"];
    if (hours === undefined || minutes === undefined) {
        throw new RangeError(`postTime "${postTime}" is not in HH:mm format.`);
    }

    return { hours: Number(hours), minutes: Number(minutes) };
}

/**
 * The thread config's schedule, or undefined for one that rotates only at its comment cap.
 * Throws a RangeError for a postTime that is not HH:mm, which the schema rules out.
 */
export function getSchedule(config: ThreadConfig): Schedule | undefined {
    if (config.frequency === undefined || config.postTime == null) {
        return undefined;
    }

    const { hours, minutes } = parsePostTime(config.postTime);
    if (config.frequency === "daily") {
        return { kind: "daily", hours, minutes };
    }

    return { kind: "weekly", weekday: WEEKLY_FREQUENCIES.indexOf(config.frequency), hours, minutes };
}
