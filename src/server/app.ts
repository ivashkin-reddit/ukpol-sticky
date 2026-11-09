import { Hono } from "hono";
import type { Context } from "hono";
import type { DevvitContext } from "../composition.js";
import { observed } from "../observed.js";
import type { SuccessLogging } from "../observed.js";
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
    readPostDeleteEvent,
    readRefreshJobEvent,
} from "./requestBodies.js";
import type { JsonObject } from "./requestBodies.js";

// The app's whole HTTP surface. Devvit Web delivers each trigger and scheduled task that devvit.json declares as a JSON
// POST to its /internal/ endpoint; these routes are exactly those endpoints, and anything else is not found. Each route
// narrows its body to the handler's event, runs the handler through `observed` with the request's own context, and
// answers in JSON without error detail, which goes only to the developer log.

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
    readonly successLogging: SuccessLogging;
    readonly handle: (body: JsonObject, context: DevvitContext) => Promise<void>;
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

function serveRoute(route: Route, getContext: () => DevvitContext): (honoContext: Context) => Promise<Response> {
    const run = observed(
        route.name,
        route.successLogging,
        async (body: JsonObject, provideContext: () => DevvitContext): Promise<void> => {
            // Built inside `observed`, so a request whose context cannot be built is logged like any other failure.
            await route.handle(body, provideContext());
        },
    );

    return async (honoContext: Context): Promise<Response> => {
        const body = await honoContext.req.json<unknown>().catch((): undefined => undefined);
        if (!isJsonObject(body)) {
            console.warn(`Ignoring a request to ${route.path} whose body is not a JSON object.`);
            return honoContext.json(ERROR_RESPONSE, HTTP_BAD_REQUEST);
        }

        try {
            await run(body, getContext);
        } catch {
            // `observed` has logged the failure.
            return honoContext.json(ERROR_RESPONSE, HTTP_INTERNAL_SERVER_ERROR);
        }

        return honoContext.json(OK_RESPONSE, HTTP_OK);
    };
}

/** The app's routes. `getContext` gives the Devvit context of the request being served, once per request. */
export function createApp(getContext: () => DevvitContext): Hono {
    const app = new Hono();
    for (const route of ROUTES) {
        app.post(route.path, serveRoute(route, getContext));
    }

    app.notFound((honoContext: Context): Response => honoContext.json({}, HTTP_NOT_FOUND));
    return app;
}
