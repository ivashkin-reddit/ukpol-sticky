import type { CommentCreateEvent, ModActionEvent, PostDeleteEvent, RefreshJobEvent } from "../triggers.js";

// Devvit Web delivers each trigger and task as a JSON body, which the server treats as untrusted input: each route
// narrows its body to the handler's event, keeping a field only when it has the expected type. A missing or mistyped
// field reads as absent, and the handler's own checks decide what an event without it means.

/** A JSON object: the shape of every Devvit trigger and task body. */
export type JsonObject = Readonly<Record<string, unknown>>;

export function isJsonObject(value: unknown): value is JsonObject {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringField(object: JsonObject, key: string): string | undefined {
    const value = object[key];
    return typeof value === "string" ? value : undefined;
}

function numberField(object: JsonObject, key: string): number | undefined {
    const value = object[key];
    return typeof value === "number" ? value : undefined;
}

function objectField(object: JsonObject, key: string): JsonObject | undefined {
    const value = object[key];
    return isJsonObject(value) ? value : undefined;
}

/** The user an event names under `key`, such as a moderator or an author, if it names one. */
function userField(object: JsonObject, key: string): Readonly<{ name: string }> | undefined {
    const user = objectField(object, key);
    if (user === undefined) {
        return undefined;
    }

    const name = stringField(user, "name");
    return name === undefined ? undefined : { name };
}

function postField(object: JsonObject): CommentCreateEvent["post"] {
    const post = objectField(object, "post");
    if (post === undefined) {
        return undefined;
    }

    const id = stringField(post, "id");
    return id === undefined ? undefined : { id, numComments: numberField(post, "numComments") };
}

export function readModActionEvent(body: JsonObject): ModActionEvent {
    return { action: stringField(body, "action"), moderator: userField(body, "moderator") };
}

export function readCommentCreateEvent(body: JsonObject): CommentCreateEvent {
    return { author: userField(body, "author"), post: postField(body) };
}

export function readPostDeleteEvent(body: JsonObject): PostDeleteEvent {
    return { postId: stringField(body, "postId") };
}

/**
 * A refresh job's thread config, from its task request's data. A job scheduled before refreshes were per thread
 * config has no data; any `configName` that is not a string reads as absent. A thread config may be named "".
 */
export function readRefreshJobEvent(body: JsonObject): RefreshJobEvent {
    const data = objectField(body, "data");
    return { configName: data === undefined ? undefined : stringField(data, "configName") };
}
