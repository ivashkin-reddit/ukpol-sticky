import { ModAction } from "@devvit/protos";
import { TriggerContext, WikiPage } from "@devvit/public-api";
import Ajv, { JSONSchemaType } from "ajv";
import json2md from "json2md";
import { compact, uniq } from "lodash";
import { parseAllDocuments } from "yaml";
import { ScheduledJob } from "./constants.js";
import { addSeconds, format } from "date-fns";

const CONFIG_PAGE = "stickymgr/config";
const CONFIG_STORAGE = "Configuration";

export const SCHEDULE_FREQUENCIES = ["daily", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays", "sundays"] as const;

export type ScheduleFrequency = typeof SCHEDULE_FREQUENCIES[number];

export interface Config {
    name: string;
    enabled: boolean;
    title: string;
    frequency?: ScheduleFrequency;
    postTime?: string;
    sticky?: boolean;
    maxComments: number;
    body: string;
    endNote?: string;
    lockOnRefresh?: boolean;
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
            postTime: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$", nullable: true },
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

export async function handleWikiUpdate (event: ModAction, context: TriggerContext) {
    if (event.action !== "wikirevise") {
        return;
    }

    if (!event.moderator?.name) {
        console.error("Moderator name is missing in the event.");
        return;
    }

    const lastRevisionKey = "LastRevision";
    const lastRevision = await context.redis.get(lastRevisionKey);

    const subredditName = context.subredditName ?? await context.reddit.getCurrentSubredditName();
    let wikiPage: WikiPage;
    try {
        wikiPage = await context.reddit.getWikiPage(subredditName, CONFIG_PAGE);
    } catch (error) {
        console.error(`Failed to fetch wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, error);
        return;
    }

    if (wikiPage.revisionId === lastRevision) {
        console.log(`No changes detected in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}.`);
        return;
    }

    const documents = parseAllDocuments(wikiPage.content);
    const parseErrors = documents.flatMap((document, index) => document.errors.map(error => `Document ${index + 1}: ${error.message}`));

    if (parseErrors.length > 0) {
        await context.reddit.modMail.createModInboxConversation({
            subredditId: context.subredditId,
            subject: `Invalid YAML in wiki page ${CONFIG_PAGE}`,
            bodyMarkdown: json2md([
                { p: `/u/${event.moderator.name}, the wiki page ${CONFIG_PAGE} contains invalid YAML. Please fix it.` },
                { p: "Errors:" },
                { blockquote: parseErrors.join("\n") },
                { p: "The existing config will be used until the issue is resolved." },
            ]),
        });
        console.error(`Invalid YAML in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, parseErrors.join(" | "));
        return;
    }

    const configs: Config[] = compact(documents.map((document) => {
        const value = document.toJSON() as unknown;
        return value == null ? undefined : value as Config;
    }));

    const ajv = new Ajv.default();
    const valid = ajv.validate(configSchema, configs);

    if (!valid) {
        console.error(`Invalid config in wiki page ${CONFIG_PAGE} in subreddit ${subredditName}:`, ajv.errorsText());
        await context.reddit.modMail.createModInboxConversation({
            subredditId: context.subredditId,
            subject: `Invalid config in wiki page ${CONFIG_PAGE}`,
            bodyMarkdown: json2md([
                { p: `/u/${event.moderator.name}, the config in wiki page ${CONFIG_PAGE} is invalid. Please fix it.` },
                { p: "Errors:" },
                { blockquote: ajv.errorsText() },
                { p: "The existing config will be used until the issue is resolved." },
            ]),
        });
        return;
    }

    for (const config of configs) {
        const hasFrequency = config.frequency != null;
        const hasPostTime = config.postTime != null;

        if (hasFrequency !== hasPostTime) {
            await context.reddit.modMail.createModInboxConversation({
                subredditId: context.subredditId,
                subject: `Incomplete schedule in config ${config.name}`,
                bodyMarkdown: json2md([
                    { p: `/u/${event.moderator.name}, config ${config.name} must define both frequency and postTime, or omit both to refresh only when maxComments is reached.` },
                ]),
            });
            return;
        }

        const dateRegex = /{{date (.+)}}/;
        const matches = dateRegex.exec(config.title);
        if (matches) {
            try {
                format(new Date(), matches[1]);
            } catch (error) {
                await context.reddit.modMail.createModInboxConversation({
                    subredditId: context.subredditId,
                    subject: `Invalid date format in config ${config.name}`,
                    bodyMarkdown: json2md([
                        { p: `/u/${event.moderator.name}, the date format in config ${config.name} is invalid. Please fix it.` },
                        { p: `The date format \`${matches[1]}\` is not a valid format string.` },
                    ]),
                });
                console.error(`Invalid date format in config ${config.name}:`, error);
                return;
            }
        }
    }

    const uniqueNames = uniq(configs.map(config => config.name));
    if (uniqueNames.length !== configs.length) {
        await context.reddit.modMail.createModInboxConversation({
            subredditId: context.subredditId,
            subject: `Duplicate config names in wiki page ${CONFIG_PAGE}`,
            bodyMarkdown: json2md([
                { p: `/u/${event.moderator.name}, there are duplicate config names in wiki page ${CONFIG_PAGE}. Please ensure all config names are unique.` },
            ]),
        });
        return;
    }

    await context.redis.set(lastRevisionKey, wikiPage.revisionId);
    await context.redis.set(CONFIG_STORAGE, JSON.stringify(configs));

    const existingJobs = await context.scheduler.listJobs();
    for (const job of existingJobs.filter(job => job.name === ScheduledJob.RefreshStickyPosts as string)) {
        await context.scheduler.cancelJob(job.id);
    }

    await context.scheduler.runJob({
        name: ScheduledJob.RefreshStickyPosts,
        runAt: addSeconds(new Date(), 1),
    });
};

export async function getConfig (context: TriggerContext): Promise<Config[]> {
    const configData = await context.redis.get(CONFIG_STORAGE);
    if (!configData) {
        console.warn(`No configuration found in storage. Returning empty config.`);
        return [];
    }

    try {
        const parsed = JSON.parse(configData) as unknown;
        if (!Array.isArray(parsed)) {
            console.error("Stored configuration is not an array. Returning empty config.");
            return [];
        }

        return parsed as Config[];
    } catch (error) {
        console.error("Failed to parse stored configuration. Returning empty config.", error);
        return [];
    }
}
