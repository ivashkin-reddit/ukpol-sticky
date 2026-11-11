import json2md from "json2md";
import type { ModeratorAlert } from "../notifications/index.js";
import type { ConfigPageProblem } from "./configPageCheck.js";
import { CONFIG_PAGE, MAX_SLOT } from "./domain/threadConfig.js";

// A config problem in the three places it is worded: the moderator alert to whoever saved the config page, the
// developer log, and the status. Kept together, so the three cannot drift apart.

const KEEPING_EXISTING_CONFIG = "The existing config will be used until the issue is resolved.";

type MarkdownBlock = Readonly<{ blockquote: string }> | Readonly<{ p: string }>;

function alert(subject: string, body: readonly MarkdownBlock[]): ModeratorAlert {
    return { subject, bodyMarkdown: json2md([...body]) };
}

function trimmed(errors: readonly string[]): string[] {
    return errors.map((error: string): string => error.trim());
}

type PinProblem = Extract<ConfigPageProblem, Readonly<{ kind: "sharedSlot" | "tooManyPinned" }>>;

/** The alert for a problem with the thread configs' pins. */
function describePinProblem(problem: PinProblem, addressee: string): ModeratorAlert {
    if (problem.kind === "sharedSlot") {
        return alert(`Two configs share slot ${String(problem.slot)}`, [
            {
                p: `${addressee}, configs ${problem.configNames[0]} and ${problem.configNames[1]} both ask for slot ${String(problem.slot)} in wiki page ${CONFIG_PAGE}. Give each pinned config its own slot.`,
            },
            { p: KEEPING_EXISTING_CONFIG },
        ]);
    }

    return alert(`Too many pinned configs in wiki page ${CONFIG_PAGE}`, [
        {
            p: `${addressee}, ${String(problem.count)} enabled configs in wiki page ${CONFIG_PAGE} are pinned (with slot or sticky: true), but Reddit holds at most ${String(MAX_SLOT)} highlights. Unpin some, then save the page again.`,
        },
        { p: KEEPING_EXISTING_CONFIG },
    ]);
}

/** The alert for a config problem, addressed to the moderator who saved the config page. */
export function describeProblem(problem: ConfigPageProblem, addressee: string): ModeratorAlert {
    switch (problem.kind) {
        case "invalidYaml":
            return alert(`Invalid YAML in wiki page ${CONFIG_PAGE}`, [
                { p: `${addressee}, the wiki page ${CONFIG_PAGE} contains invalid YAML. Please fix it.` },
                { p: "Errors:" },
                { blockquote: problem.errors.join("\n") },
                { p: KEEPING_EXISTING_CONFIG },
            ]);
        case "invalidSchema":
            return alert(`Invalid config in wiki page ${CONFIG_PAGE}`, [
                { p: `${addressee}, the config in wiki page ${CONFIG_PAGE} is invalid. Please fix it.` },
                { p: "Errors:" },
                { blockquote: problem.errors },
                { p: KEEPING_EXISTING_CONFIG },
            ]);
        case "incompleteSchedule":
            return alert(`Incomplete schedule in config ${problem.configName}`, [
                {
                    p: `${addressee}, config ${problem.configName} must define both frequency and postTime, or omit both to refresh only when maxComments is reached.`,
                },
            ]);
        case "invalidDateFormat":
            return alert(`Invalid date format in config ${problem.configName}`, [
                { p: `${addressee}, the date format in config ${problem.configName} is invalid. Please fix it.` },
                { p: `The date format \`${problem.dateFormat}\` is not a valid format string.` },
            ]);
        case "duplicateNames":
            return alert(`Duplicate config names in wiki page ${CONFIG_PAGE}`, [
                {
                    p: `${addressee}, there are duplicate config names in wiki page ${CONFIG_PAGE}. Please ensure all config names are unique.`,
                },
            ]);
        case "invalidValue":
            return alert(`Invalid config in wiki page ${CONFIG_PAGE}`, [
                { p: `${addressee}, config "${problem.configName}" is invalid: ${problem.reason}. Please fix it.` },
                { p: KEEPING_EXISTING_CONFIG },
            ]);
        case "sharedSlot":
        case "tooManyPinned":
            return describePinProblem(problem, addressee);
    }
}

/** A config problem in one line, for the app's logs. */
export function summarizeProblem(problem: ConfigPageProblem): string {
    switch (problem.kind) {
        case "invalidYaml":
            return `invalid YAML: ${trimmed(problem.errors).join(" | ")}`;
        case "invalidSchema":
            return `invalid config: ${problem.errors}`;
        case "incompleteSchedule":
            return `thread config ${problem.configName} sets only one of frequency and postTime`;
        case "invalidDateFormat":
            return `thread config ${problem.configName} has an invalid date format (${problem.dateFormat}): ${problem.cause.message}`;
        case "duplicateNames":
            return "two thread configs share a name";
        case "invalidValue":
            return `thread config "${problem.configName}" is invalid: ${problem.reason}`;
        case "sharedSlot":
            return `thread configs ${problem.configNames[0]} and ${problem.configNames[1]} share slot ${String(problem.slot)}`;
        case "tooManyPinned":
            return `${String(problem.count)} enabled thread configs are pinned; at most ${String(MAX_SLOT)} can be`;
    }
}

/** A config problem in one paragraph, for the status. */
export function describeProblemForStatus(problem: ConfigPageProblem): string {
    switch (problem.kind) {
        case "invalidYaml":
            return `The page contains invalid YAML: ${trimmed(problem.errors).join(" ")}`;
        case "invalidSchema":
            return `The config is invalid: ${problem.errors}.`;
        case "incompleteSchedule":
            return `Config ${problem.configName} must define both frequency and postTime, or omit both to refresh only when maxComments is reached.`;
        case "invalidDateFormat":
            return `The date format \`${problem.dateFormat}\` in config ${problem.configName} is not a valid format string.`;
        case "duplicateNames":
            return "Two configs share a name; every config name must be unique.";
        case "invalidValue":
            return `Config "${problem.configName}" is invalid: ${problem.reason}.`;
        case "sharedSlot":
            return `Configs ${problem.configNames[0]} and ${problem.configNames[1]} both ask for slot ${String(problem.slot)}; each pinned config needs its own slot.`;
        case "tooManyPinned":
            return `${String(problem.count)} enabled configs are pinned, but Reddit holds at most ${String(MAX_SLOT)} highlights.`;
    }
}
