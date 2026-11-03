import json2md from "json2md";
import { compact } from "lodash";
import { parseAllDocuments } from "yaml";
import type { ModeratorAlert } from "../notifications/index.js";
import { checkThreadConfigs, CONFIG_PAGE } from "./domain/threadConfig.js";
import type { ConfigProblem, ThreadConfig } from "./domain/threadConfig.js";
import type { ConfigPageRevision, ConfigurationPorts } from "./ports.js";
import { storeThreadConfigs } from "./storedConfigs.js";

const KEEPING_EXISTING_CONFIG = "The existing config will be used until the issue is resolved.";

/** What became of a config page revision: its thread configs were stored, or why they were not. */
export type ConfigPageOutcome = "rejected" | "stored" | "unavailable" | "unchanged";

type MarkdownBlock = Readonly<{ blockquote: string }> | Readonly<{ p: string }>;

function alert(subject: string, body: readonly MarkdownBlock[]): ModeratorAlert {
    return { subject, bodyMarkdown: json2md([...body]) };
}

/** The alert for a config problem, addressed to the moderator who saved the config page. */
function describeProblem(problem: ConfigProblem, moderatorName: string): ModeratorAlert {
    switch (problem.kind) {
        case "invalidSchema":
            return alert(`Invalid config in wiki page ${CONFIG_PAGE}`, [
                { p: `/u/${moderatorName}, the config in wiki page ${CONFIG_PAGE} is invalid. Please fix it.` },
                { p: "Errors:" },
                { blockquote: problem.errors },
                { p: KEEPING_EXISTING_CONFIG },
            ]);
        case "incompleteSchedule":
            return alert(`Incomplete schedule in config ${problem.configName}`, [
                {
                    p: `/u/${moderatorName}, config ${problem.configName} must define both frequency and postTime, or omit both to refresh only when maxComments is reached.`,
                },
            ]);
        case "invalidDateFormat":
            return alert(`Invalid date format in config ${problem.configName}`, [
                {
                    p: `/u/${moderatorName}, the date format in config ${problem.configName} is invalid. Please fix it.`,
                },
                { p: `The date format \`${problem.dateFormat}\` is not a valid format string.` },
            ]);
        case "duplicateNames":
            return alert(`Duplicate config names in wiki page ${CONFIG_PAGE}`, [
                {
                    p: `/u/${moderatorName}, there are duplicate config names in wiki page ${CONFIG_PAGE}. Please ensure all config names are unique.`,
                },
            ]);
        case "invalidValue":
            return alert(`Invalid config in wiki page ${CONFIG_PAGE}`, [
                {
                    p: `/u/${moderatorName}, config "${problem.configName}" is invalid: ${problem.reason}. Please fix it.`,
                },
                { p: KEEPING_EXISTING_CONFIG },
            ]);
    }
}

/** A config problem in one line, for the app's logs. */
function summarizeProblem(problem: ConfigProblem): string {
    switch (problem.kind) {
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
    }
}

interface YamlDocument {
    readonly errors: readonly Readonly<{ message: string }>[];
    readonly toJSON: () => unknown;
}

function describeYamlErrors(parseErrors: readonly string[], moderatorName: string): ModeratorAlert {
    return alert(`Invalid YAML in wiki page ${CONFIG_PAGE}`, [
        { p: `/u/${moderatorName}, the wiki page ${CONFIG_PAGE} contains invalid YAML. Please fix it.` },
        { p: "Errors:" },
        { blockquote: parseErrors.join("\n") },
        { p: KEEPING_EXISTING_CONFIG },
    ]);
}

/**
 * The documents' values, or the errors that kept documents from producing one. An alias to an anchor that does not
 * exist (or is in another document) parses without errors and only fails here.
 */
function documentValues(
    documents: readonly YamlDocument[],
): Readonly<{ errors: string[] }> | Readonly<{ values: unknown[] }> {
    const errors: string[] = [];
    const values: unknown[] = [];
    for (const [index, document] of documents.entries()) {
        try {
            values.push(document.toJSON());
        } catch (error: unknown) {
            if (!(error instanceof Error)) {
                throw error;
            }

            errors.push(`Document ${String(index + 1)}: ${error.message}`);
        }
    }

    return errors.length > 0 ? { errors } : { values };
}

type Rejection = Readonly<{ alert: ModeratorAlert; summary: string }>;

function rejectYaml(errors: readonly string[], moderatorName: string): Rejection & Readonly<{ kind: "invalid" }> {
    return {
        kind: "invalid",
        alert: describeYamlErrors(errors, moderatorName),
        summary: `invalid YAML: ${errors.map((error): string => error.trim()).join(" | ")}`,
    };
}

type PageCheck =
    (Rejection & Readonly<{ kind: "invalid" }>) | Readonly<{ kind: "valid"; configs: readonly ThreadConfig[] }>;

/** The config page's YAML documents as values, or the errors in parsing them. */
function parseConfigPage(content: string): Readonly<{ errors: string[] }> | Readonly<{ values: unknown[] }> {
    const documents: readonly YamlDocument[] = parseAllDocuments(content);
    const parseErrors = documents.flatMap((document: YamlDocument, index: number): string[] =>
        document.errors.map(
            (error: Readonly<{ message: string }>): string => `Document ${String(index + 1)}: ${error.message}`,
        ),
    );
    return parseErrors.length > 0 ? { errors: parseErrors } : documentValues(documents);
}

/** Parses the config page's YAML documents and checks the thread configs they define. */
function checkConfigPage(content: string, moderatorName: string): PageCheck {
    const parsed = parseConfigPage(content);
    if ("errors" in parsed) {
        return rejectYaml(parsed.errors, moderatorName);
    }

    // Empty documents parse to null; compact drops them before checking.
    const check = checkThreadConfigs(compact(parsed.values));
    if (check.kind === "invalid") {
        return {
            kind: "invalid",
            alert: describeProblem(check.problem, moderatorName),
            summary: summarizeProblem(check.problem),
        };
    }

    return check;
}

type RevisionRead =
    Readonly<{ kind: "new"; revision: ConfigPageRevision }> | Readonly<{ kind: "unavailable" | "unchanged" }>;

/**
 * Reads the config page, telling a revision not yet checked from one already accepted or rejected, or a failed read.
 * Every wiki revision in the subreddit (usernotes, the AutoModerator page) triggers a read, so remembering the
 * rejected revision keeps moderators from being alerted to it again.
 */
async function readNewRevision(ports: Pick<ConfigurationPorts, "page" | "store">): Promise<RevisionRead> {
    const acceptedRevision = await ports.store.readAcceptedRevision();
    const rejectedRevision = await ports.store.readRejectedRevision();
    const revision = await ports.page.read();
    if (revision === undefined) {
        return { kind: "unavailable" };
    }

    if (revision.revisionId === acceptedRevision || revision.revisionId === rejectedRevision) {
        const verdict = revision.revisionId === acceptedRevision ? "accepted" : "rejected";
        console.log(`Config page revision ${revision.revisionId} is already ${verdict}.`);
        return { kind: "unchanged" };
    }

    return { kind: "new", revision };
}

async function rejectRevision(
    revision: ConfigPageRevision,
    rejection: Rejection,
    ports: Pick<ConfigurationPorts, "notifyModerators" | "store">,
): Promise<void> {
    console.warn(`Rejected config page revision ${revision.revisionId}: ${rejection.summary}.`);
    await ports.notifyModerators(rejection.alert);
    // Recorded once the alert is sent, so an alert that failed to send is retried by the next wiki revision event.
    await ports.store.writeRejectedRevision(revision.revisionId);
}

async function acceptRevision(
    revision: ConfigPageRevision,
    configs: readonly ThreadConfig[],
    ports: ConfigurationPorts,
): Promise<void> {
    // Thread configs first: a failure in between then leaves the revision unaccepted, so applying it again stores them.
    await storeThreadConfigs(configs, ports);
    await ports.store.writeAcceptedRevision(revision.revisionId);
    console.log(`Accepted config page revision ${revision.revisionId}: ${String(configs.length)} thread configs.`);
}

/**
 * Reads the config page after a moderator revised it. A revision not yet accepted is checked: its thread configs are
 * stored, or the moderator is alerted to the first config problem and the previously stored configs stay in force.
 */
export async function applyConfigPageRevision(
    moderatorName: string,
    ports: ConfigurationPorts,
): Promise<ConfigPageOutcome> {
    const read = await readNewRevision(ports);
    if (read.kind !== "new") {
        return read.kind;
    }

    const check = checkConfigPage(read.revision.content, moderatorName);
    if (check.kind === "invalid") {
        await rejectRevision(read.revision, check, ports);
        return "rejected";
    }

    await acceptRevision(read.revision, check.configs, ports);
    return "stored";
}
