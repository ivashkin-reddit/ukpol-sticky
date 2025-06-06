import { ModAction } from "@devvit/protos";
import { TriggerContext, WikiPage } from "@devvit/public-api";
import Ajv, { JSONSchemaType } from "ajv";
import json2md from "json2md";
import { compact } from "lodash";
import { parseAllDocuments } from "yaml";
import { ScheduledJob } from "./constants.js";
import { addSeconds, format } from "date-fns";

const CONFIG_PAGE = "stickymgr/config";
const CONFIG_STORAGE = "Configuration";

export interface Config {
    name: string;
    enabled: boolean;
    title: string;
    frequency: "daily" | "mondays" | "tuesdays" | "wednesdays" | "thursdays" | "fridays" | "saturdays" | "sundays";
    postTime: string;
    stickyPosition?: 1 | 2;
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
            frequency: { type: "string", enum: ["daily", "mondays", "tuesdays", "wednesdays", "thursdays", "fridays", "saturdays", "sundays"] },
            postTime: { type: "string", pattern: "^(?:[01]\\d|2[0-3]):[0-5]\\d$" },
            stickyPosition: { type: "integer", enum: [1, 2], nullable: true },
            maxComments: { type: "number" },
            body: { type: "string" },
            endNote: { type: "string", nullable: true },
            lockOnRefresh: { type: "boolean", nullable: true },
        },
        required: ["name", "enabled", "title", "frequency", "postTime", "maxComments", "body"],
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
    const configs: Config[] = compact(documents.map(doc => doc.toJSON() as Config));

    const ajv = new Ajv.default();
    const valid = ajv.validate(configSchema, configs);

    if (!valid) {
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

    await context.redis.set(lastRevisionKey, wikiPage.revisionId);
    await context.redis.set(CONFIG_STORAGE, JSON.stringify(configs));

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

    return JSON.parse(configData) as Config[];
}
