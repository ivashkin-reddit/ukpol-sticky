import json2md from "json2md";
import { compact } from "lodash";
import { parseAllDocuments } from "yaml";
import { notifyModerators } from "../notifications/index.js";
import type { ModeratorAlert, NotificationContext } from "../notifications/index.js";
import { getSubredditName } from "../platform/index.js";
import type { RedisPort, SubredditNamePort } from "../platform/index.js";
import { storeThreadConfigs } from "./configStore.js";
import { checkThreadConfigs, CONFIG_PAGE } from "./threadConfig.js";
import type { ConfigProblem, ThreadConfig } from "./threadConfig.js";

// Live state in every installed subreddit: the config page revision whose thread configs were last accepted.
const LAST_REVISION_KEY = "LastRevision";
const KEEPING_EXISTING_CONFIG = "The existing config will be used until the issue is resolved.";

interface WikiRevision {
    readonly content: string;
    readonly revisionId: string;
}

export type ConfigPageRevisionContext = NotificationContext &
    SubredditNamePort &
    Readonly<{
        redis: RedisPort<"del" | "get" | "set">;
        reddit: Readonly<{ getWikiPage: (subredditName: string, page: string) => Promise<WikiRevision> }>;
    }>;

/** What became of a config page revision: its thread configs were stored, or why they were not. */
export type ConfigPageOutcome = "rejected" | "stored" | "unavailable" | "unchanged";

type MarkdownBlock = Readonly<{ blockquote: string }> | Readonly<{ p: string }>;

function alert(subject: string, body: readonly MarkdownBlock[]): ModeratorAlert {
    return { subject, bodyMarkdown: json2md([...body]) };
}

/** The alert for a config problem, logging the problems that carry detail worth keeping in the app's logs. */
function describeProblem(problem: ConfigProblem, moderatorName: string, subredditName: string): ModeratorAlert {
    switch (problem.kind) {
        case "invalidSchema":
            console.error(`Invalid config in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, problem.errors);
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
            console.error(`Invalid date format in config ${problem.configName}:`, problem.cause);
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
    }
}

interface YamlDocument {
    readonly errors: readonly Readonly<{ message: string }>[];
    readonly toJSON: () => unknown;
}

function describeYamlErrors(
    parseErrors: readonly string[],
    moderatorName: string,
    subredditName: string,
): ModeratorAlert {
    console.error(`Invalid YAML in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, parseErrors.join(" | "));
    return alert(`Invalid YAML in wiki page ${CONFIG_PAGE}`, [
        { p: `/u/${moderatorName}, the wiki page ${CONFIG_PAGE} contains invalid YAML. Please fix it.` },
        { p: "Errors:" },
        { blockquote: parseErrors.join("\n") },
        { p: KEEPING_EXISTING_CONFIG },
    ]);
}

type PageCheck =
    | Readonly<{ kind: "invalid"; alert: ModeratorAlert }>
    | Readonly<{ kind: "valid"; configs: readonly ThreadConfig[] }>;

/** Parses the config page's YAML documents and checks the thread configs they define. */
function checkConfigPage(content: string, moderatorName: string, subredditName: string): PageCheck {
    const documents: readonly YamlDocument[] = parseAllDocuments(content);
    const parseErrors = documents.flatMap((document: YamlDocument, index: number): string[] =>
        document.errors.map(
            (error: Readonly<{ message: string }>): string => `Document ${String(index + 1)}: ${error.message}`,
        ),
    );
    if (parseErrors.length > 0) {
        return { kind: "invalid", alert: describeYamlErrors(parseErrors, moderatorName, subredditName) };
    }

    // Empty documents parse to null; compact drops them before checking.
    const check = checkThreadConfigs(compact(documents.map((document: YamlDocument): unknown => document.toJSON())));
    if (check.kind === "invalid") {
        return { kind: "invalid", alert: describeProblem(check.problem, moderatorName, subredditName) };
    }

    return check;
}

async function fetchConfigPage(
    context: ConfigPageRevisionContext,
    subredditName: string,
): Promise<WikiRevision | undefined> {
    try {
        return await context.reddit.getWikiPage(subredditName, CONFIG_PAGE);
    } catch (error: unknown) {
        console.error(`Failed to fetch wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, error);
        return undefined;
    }
}

/**
 * Reads the config page after a moderator revised it. A revision not yet accepted is checked: its thread configs are
 * stored, or the moderator is alerted to the first config problem and the previously stored configs stay in force.
 */
type RevisionRead =
    | Readonly<{ kind: "new"; revision: WikiRevision; subredditName: string }>
    | Readonly<{ kind: "unavailable" | "unchanged" }>;

/** Fetches the config page, telling apart a revision not yet accepted from one already accepted or a failed fetch. */
async function readNewRevision(context: ConfigPageRevisionContext): Promise<RevisionRead> {
    const lastRevision = await context.redis.get(LAST_REVISION_KEY);
    const subredditName = await getSubredditName(context);
    const revision = await fetchConfigPage(context, subredditName);
    if (revision === undefined) {
        return { kind: "unavailable" };
    }

    if (revision.revisionId === lastRevision) {
        console.log(`No changes detected in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}.`);
        return { kind: "unchanged" };
    }

    return { kind: "new", revision, subredditName };
}

async function acceptRevision(
    context: ConfigPageRevisionContext,
    revisionId: string,
    configs: readonly ThreadConfig[],
): Promise<void> {
    await context.redis.set(LAST_REVISION_KEY, revisionId);
    await storeThreadConfigs(context, configs);
}

export async function applyConfigPageRevision(
    moderatorName: string,
    context: ConfigPageRevisionContext,
): Promise<ConfigPageOutcome> {
    const read = await readNewRevision(context);
    if (read.kind !== "new") {
        return read.kind;
    }

    const { revision, subredditName } = read;
    const check = checkConfigPage(revision.content, moderatorName, subredditName);
    if (check.kind === "invalid") {
        await notifyModerators(context, check.alert);
        return "rejected";
    }

    await acceptRevision(context, revision.revisionId, check.configs);
    return "stored";
}
