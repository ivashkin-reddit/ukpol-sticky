import type { UiResponse } from "@devvit/web/shared";
import { Hono } from "hono";
import type { Context } from "hono";
import type { DevvitContext } from "../composition.js";
import { observed } from "../observed.js";
import type { SuccessLogging } from "../observed.js";
import { onPinForm, onPinMenu } from "../pinToSlot.js";
import { onStatusForm, onStatusMenu } from "../status.js";
import {
    onAppInstall,
    onAppUpgrade,
    onCommentCreate,
    onModAction,
    onPostDelete,
    onRefreshCheck,
    onRefreshJob,
} from "../triggers.js";
import {
    isJsonObject,
    readCommentCreateEvent,
    readModActionEvent,
    readPinFormEvent,
    readPinMenuEvent,
    readPostDeleteEvent,
    readRefreshJobEvent,
    readStatusFormEvent,
} from "./requestBodies.js";
import type { JsonObject } from "./requestBodies.js";

// The app's whole HTTP surface. Devvit Web delivers each trigger and scheduled task that devvit.json declares as a JSON
// POST to its /internal/ endpoint; these routes are exactly those endpoints, and anything else is not found. Each route
// narrows its body to the handler's event, runs the handler through `observed` with the request's own context, and
// answers in JSON without error detail, which goes only to the developer log. Each menu item and form that devvit.json
// declares is a UI route: it answers with what Reddit's UI shows next, and a failure with a fixed message, again
// without detail.

const HTTP_OK = 200;
const HTTP_BAD_REQUEST = 400;
const HTTP_NOT_FOUND = 404;
const HTTP_INTERNAL_SERVER_ERROR = 500;

const OK_RESPONSE: Readonly<{ status: string }> = { status: "ok" };
const ERROR_RESPONSE: Readonly<{ status: string }> = { status: "error" };

interface Route {
    readonly path: string;
    /** The handler's name in logs. */
    readonly name: string;
    /** What one run is for, from its body, added to its name in logs; undefined when there is nothing to add. */
    readonly subject?: (body: JsonObject) => string | undefined;
    readonly successLogging: SuccessLogging;
    readonly handle: (body: JsonObject, context: DevvitContext) => Promise<void>;
}

function describeRefreshJob(body: JsonObject): string | undefined {
    const { configName } = readRefreshJobEvent(body);
    return configName === undefined ? undefined : `thread config ${configName}`;
}

const ROUTES: readonly Route[] = [
    {
        path: "/internal/triggers/mod-action",
        name: "ModAction trigger",
        successLogging: "failures only",
        handle: async (body: JsonObject, context: DevvitContext): Promise<void> => {
            await onModAction(readModActionEvent(body), context);
        },
    },
    {
        path: "/internal/triggers/comment-create",
        name: "CommentCreate trigger",
        successLogging: "failures only",
        handle: async (body: JsonObject, context: DevvitContext): Promise<void> => {
            await onCommentCreate(readCommentCreateEvent(body), context);
        },
    },
    {
        path: "/internal/triggers/post-delete",
        name: "PostDelete trigger",
        successLogging: "failures only",
        handle: async (body: JsonObject, context: DevvitContext): Promise<void> => {
            await onPostDelete(readPostDeleteEvent(body), context);
        },
    },
    {
        path: "/internal/triggers/app-install",
        name: "AppInstall trigger",
        successLogging: "every run",
        handle: onAppInstall,
    },
    {
        path: "/internal/triggers/app-upgrade",
        name: "AppUpgrade trigger",
        successLogging: "every run",
        handle: onAppUpgrade,
    },
    {
        path: "/internal/jobs/refresh",
        name: "Refresh job",
        subject: describeRefreshJob,
        successLogging: "every run",
        handle: async (body: JsonObject, context: DevvitContext): Promise<void> => {
            await onRefreshJob(readRefreshJobEvent(body), context);
        },
    },
    {
        path: "/internal/jobs/refresh-check",
        name: "Refresh check",
        successLogging: "every run",
        handle: onRefreshCheck,
    },
];

/** A route for a moderator's action in Reddit's UI: it answers with what the UI shows next. */
interface UiRoute {
    readonly path: string;
    /** The handler's name in logs. */
    readonly name: string;
    /** The toast the UI shows when the handler fails: a fixed message, with no detail. */
    readonly failureToast: string;
    readonly handle: (body: JsonObject, context: DevvitContext) => Promise<UiResponse>;
}

const STATUS_FAILURE = "Sticky Manager could not show its status. Try again shortly.";
const PIN_MENU_FAILURE = "Sticky Manager could not open Pin to slot. Try again shortly.";
const PIN_FORM_FAILURE = "Sticky Manager could not pin that post. Try again shortly.";

const UI_ROUTES: readonly UiRoute[] = [
    { path: "/internal/menu/status", name: "Status menu", failureToast: STATUS_FAILURE, handle: onStatusMenu },
    {
        path: "/internal/forms/status",
        name: "Status form",
        failureToast: STATUS_FAILURE,
        handle: async (body: JsonObject, context: DevvitContext): Promise<UiResponse> =>
            await onStatusForm(readStatusFormEvent(body), context),
    },
    {
        path: "/internal/menu/pin",
        name: "Pin menu",
        failureToast: PIN_MENU_FAILURE,
        handle: async (body: JsonObject, context: DevvitContext): Promise<UiResponse> =>
            await onPinMenu(readPinMenuEvent(body), context),
    },
    {
        path: "/internal/forms/pin",
        name: "Pin form",
        failureToast: PIN_FORM_FAILURE,
        handle: async (body: JsonObject, context: DevvitContext): Promise<UiResponse> =>
            await onPinForm(readPinFormEvent(body), context),
    },
];

/** A run's name in logs: its handler's name, and what the run is for when its body says. */
function nameRun(route: Route, body: JsonObject): string {
    const subject = route.subject?.(body);
    return subject === undefined ? route.name : `${route.name} for ${subject}`;
}

/** The request's body when it is a JSON object; otherwise undefined, once the request is logged as ignored. */
async function readBody(honoContext: Context, path: string): Promise<JsonObject | undefined> {
    const body = await honoContext.req.json<unknown>().catch((): undefined => undefined);
    if (isJsonObject(body)) {
        return body;
    }

    console.warn(`Ignoring a request to ${path} whose body is not a JSON object.`);
    return undefined;
}

function serveRoute(route: Route, getContext: () => DevvitContext): (honoContext: Context) => Promise<Response> {
    return async (honoContext: Context): Promise<Response> => {
        const body = await readBody(honoContext, route.path);
        if (body === undefined) {
            return honoContext.json(ERROR_RESPONSE, HTTP_BAD_REQUEST);
        }

        const run = observed(
            nameRun(route, body),
            route.successLogging,
            async (event: JsonObject, provideContext: () => DevvitContext): Promise<void> => {
                // Built inside `observed`, so a request whose context cannot be built is logged like any other failure.
                await route.handle(event, provideContext());
            },
        );
        try {
            await run(body, getContext);
        } catch {
            // `observed` has logged the failure.
            return honoContext.json(ERROR_RESPONSE, HTTP_INTERNAL_SERVER_ERROR);
        }

        return honoContext.json(OK_RESPONSE, HTTP_OK);
    };
}

function serveUiRoute(route: UiRoute, getContext: () => DevvitContext): (honoContext: Context) => Promise<Response> {
    return async (honoContext: Context): Promise<Response> => {
        const body = await readBody(honoContext, route.path);
        if (body === undefined) {
            return honoContext.json(ERROR_RESPONSE, HTTP_BAD_REQUEST);
        }

        const run = observed(
            route.name,
            "every run",
            async (event: JsonObject, provideContext: () => DevvitContext): Promise<UiResponse> =>
                await route.handle(event, provideContext()),
        );
        // `observed` has logged any failure; the moderator sees only the route's fixed message.
        const response = await run(body, getContext).catch((): UiResponse => ({ showToast: route.failureToast }));
        return honoContext.json(response, HTTP_OK);
    };
}

/** The app's routes. `getContext` gives the Devvit context of the request being served, once per request. */
export function createApp(getContext: () => DevvitContext): Hono {
    const app = new Hono();
    for (const route of ROUTES) {
        app.post(route.path, serveRoute(route, getContext));
    }

    for (const route of UI_ROUTES) {
        app.post(route.path, serveUiRoute(route, getContext));
    }

    app.notFound((honoContext: Context): Response => honoContext.json({}, HTTP_NOT_FOUND));
    return app;
}
