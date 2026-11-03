import type { TriggerContext } from "@devvit/public-api";
import { asT5ID } from "@devvit/public-api/types/tid.js";
import { addSeconds, format } from "date-fns";
import json2md from "json2md";
import { compact, uniq } from "lodash";
import { parseAllDocuments } from "yaml";
import { CONFIG_PAGE, storeConfig, validateConfigList } from "./config.js";
import type { Config } from "./config.js";
import { getSubredditName } from "./ports.js";
import type { RedisPort, SubredditNamePort } from "./ports.js";
import { cancelRefreshJobs, scheduleRefresh } from "./refreshJob.js";
import type { RefreshJobContext } from "./refreshJob.js";
import { findDateToken } from "./titleTemplate.js";

const LAST_REVISION_KEY = "LastRevision";
const FIRST_REFRESH_DELAY_SECONDS = 1;
const KEEPING_EXISTING_CONFIG = "The existing config will be used until the issue is resolved.";

export type WikiUpdateEvent = Readonly<{
    action?: string | undefined;
    moderator?: Readonly<{ name: string }> | undefined;
}>;

interface WikiRevision {
    readonly content: string;
    readonly revisionId: string;
}

export type WikiUpdateContext = RefreshJobContext &
    SubredditNamePort &
    Readonly<{
        redis: RedisPort<"del" | "get" | "set">;
        reddit: Readonly<{
            getWikiPage: (subredditName: string, page: string) => Promise<WikiRevision>;
            modMail: Readonly<Pick<TriggerContext["reddit"]["modMail"], "createModInboxConversation">>;
        }>;
        subredditId: string;
    }>;

interface ConfigProblem {
    readonly subject: string;
    readonly bodyMarkdown: string;
}

type ConfigPageResult =
    Readonly<{ kind: "invalid"; problem: ConfigProblem }> | Readonly<{ kind: "valid"; configs: readonly Config[] }>;

type MarkdownBlock = Readonly<{ blockquote: string }> | Readonly<{ p: string }>;

function invalid(subject: string, body: readonly MarkdownBlock[]): ConfigPageResult {
    return { kind: "invalid", problem: { subject, bodyMarkdown: json2md([...body]) } };
}

function checkSchedule(config: Config, moderatorName: string): ConfigPageResult | undefined {
    const hasFrequency = config.frequency !== undefined;
    const hasPostTime = config.postTime != null;
    if (hasFrequency === hasPostTime) {
        return undefined;
    }

    return invalid(`Incomplete schedule in config ${config.name}`, [
        {
            p: `/u/${moderatorName}, config ${config.name} must define both frequency and postTime, or omit both to refresh only when maxComments is reached.`,
        },
    ]);
}

function checkDateFormat(config: Config, moderatorName: string): ConfigPageResult | undefined {
    const token = findDateToken(config.title);
    if (token === undefined) {
        return undefined;
    }

    try {
        format(new Date(), token.dateFormat);
        return undefined;
    } catch (error: unknown) {
        // date-fns reports an unusable format string with a RangeError; anything else is a fault, not bad config.
        if (!(error instanceof RangeError)) {
            throw error;
        }

        console.error(`Invalid date format in config ${config.name}:`, error);
        return invalid(`Invalid date format in config ${config.name}`, [
            { p: `/u/${moderatorName}, the date format in config ${config.name} is invalid. Please fix it.` },
            { p: `The date format \`${token.dateFormat}\` is not a valid format string.` },
        ]);
    }
}

function checkConfigs(configs: readonly Config[], moderatorName: string): ConfigPageResult {
    for (const config of configs) {
        const problem = checkSchedule(config, moderatorName) ?? checkDateFormat(config, moderatorName);
        if (problem !== undefined) {
            return problem;
        }
    }

    if (uniq(configs.map((config): string => config.name)).length !== configs.length) {
        return invalid(`Duplicate config names in wiki page ${CONFIG_PAGE}`, [
            {
                p: `/u/${moderatorName}, there are duplicate config names in wiki page ${CONFIG_PAGE}. Please ensure all config names are unique.`,
            },
        ]);
    }

    return { kind: "valid", configs };
}

interface YamlDocument {
    readonly errors: readonly Readonly<{ message: string }>[];
    readonly toJSON: () => unknown;
}

function checkYaml(
    documents: readonly YamlDocument[],
    moderatorName: string,
    subredditName: string,
): ConfigPageResult | undefined {
    const parseErrors = documents.flatMap((document: YamlDocument, index: number): string[] =>
        document.errors.map(
            (error: Readonly<{ message: string }>): string => `Document ${String(index + 1)}: ${error.message}`,
        ),
    );
    if (parseErrors.length === 0) {
        return undefined;
    }

    console.error(`Invalid YAML in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, parseErrors.join(" | "));
    return invalid(`Invalid YAML in wiki page ${CONFIG_PAGE}`, [
        { p: `/u/${moderatorName}, the wiki page ${CONFIG_PAGE} contains invalid YAML. Please fix it.` },
        { p: "Errors:" },
        { blockquote: parseErrors.join("\n") },
        { p: KEEPING_EXISTING_CONFIG },
    ]);
}

function checkSchema(values: readonly unknown[], moderatorName: string, subredditName: string): ConfigPageResult {
    const validation = validateConfigList(values);
    if (validation.kind === "invalid") {
        console.error(`Invalid config in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, validation.errors);
        return invalid(`Invalid config in wiki page ${CONFIG_PAGE}`, [
            { p: `/u/${moderatorName}, the config in wiki page ${CONFIG_PAGE} is invalid. Please fix it.` },
            { p: "Errors:" },
            { blockquote: validation.errors },
            { p: KEEPING_EXISTING_CONFIG },
        ]);
    }

    return checkConfigs(validation.configs, moderatorName);
}

function checkConfigPage(content: string, moderatorName: string, subredditName: string): ConfigPageResult {
    const documents = parseAllDocuments(content);
    // Empty documents parse to null; compact drops them before validating.
    return (
        checkYaml(documents, moderatorName, subredditName) ??
        checkSchema(
            compact(documents.map((document: YamlDocument): unknown => document.toJSON())),
            moderatorName,
            subredditName,
        )
    );
}

function getRevisingModerator(event: WikiUpdateEvent): string | undefined {
    if (event.action !== "wikirevise") {
        return undefined;
    }

    // Protobuf fields default to "", so an empty name means the moderator is missing.
    const moderatorName = event.moderator?.name ?? "";
    if (moderatorName === "") {
        console.error("Moderator name is missing in the event.");
        return undefined;
    }

    return moderatorName;
}

async function fetchConfigPage(context: WikiUpdateContext, subredditName: string): Promise<WikiRevision | undefined> {
    try {
        return await context.reddit.getWikiPage(subredditName, CONFIG_PAGE);
    } catch (error: unknown) {
        console.error(`Failed to fetch wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, error);
        return undefined;
    }
}

interface ChangedConfigPage {
    readonly revision: WikiRevision;
    readonly subredditName: string;
}

async function fetchChangedConfigPage(context: WikiUpdateContext): Promise<ChangedConfigPage | undefined> {
    const lastRevision = await context.redis.get(LAST_REVISION_KEY);
    const subredditName = await getSubredditName(context);
    const revision = await fetchConfigPage(context, subredditName);
    if (revision === undefined) {
        return undefined;
    }

    if (revision.revisionId === lastRevision) {
        console.log(`No changes detected in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}.`);
        return undefined;
    }

    return { revision, subredditName };
}

async function reportProblem(context: WikiUpdateContext, problem: ConfigProblem): Promise<void> {
    await context.reddit.modMail.createModInboxConversation({
        subredditId: asT5ID(context.subredditId),
        subject: problem.subject,
        bodyMarkdown: problem.bodyMarkdown,
    });
}

async function saveConfig(context: WikiUpdateContext, revisionId: string, configs: readonly Config[]): Promise<void> {
    await context.redis.set(LAST_REVISION_KEY, revisionId);
    await storeConfig(context, configs);
    await cancelRefreshJobs(context);
    await scheduleRefresh(context, addSeconds(new Date(), FIRST_REFRESH_DELAY_SECONDS));
}

export async function handleWikiUpdate(event: WikiUpdateEvent, context: WikiUpdateContext): Promise<void> {
    const moderatorName = getRevisingModerator(event);
    if (moderatorName === undefined) {
        return;
    }

    const changedPage = await fetchChangedConfigPage(context);
    if (changedPage === undefined) {
        return;
    }

    const result = checkConfigPage(changedPage.revision.content, moderatorName, changedPage.subredditName);
    switch (result.kind) {
        case "invalid":
            await reportProblem(context, result.problem);
            return;
        case "valid":
            await saveConfig(context, changedPage.revision.revisionId, result.configs);
    }
}
