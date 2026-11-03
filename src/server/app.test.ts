import { describe, expect, it, vi } from "vitest";
import { freezeDate } from "../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../tests/support/fakeDevvitContext.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { DevvitContext } from "../composition.js";
import {
    onAppInstall,
    onAppUpgrade,
    onCommentCreate,
    onModAction,
    onPostDelete,
    onRefreshCheck,
    onRefreshJob,
} from "../triggers.js";
import type * as Triggers from "../triggers.js";
import { createApp } from "./app.js";

vi.mock(import("../triggers.js"), (): Partial<typeof Triggers> => ({
    onAppInstall: vi.fn<typeof onAppInstall>(),
    onAppUpgrade: vi.fn<typeof onAppUpgrade>(),
    onCommentCreate: vi.fn<typeof onCommentCreate>(),
    onModAction: vi.fn<typeof onModAction>(),
    onPostDelete: vi.fn<typeof onPostDelete>(),
    onRefreshCheck: vi.fn<typeof onRefreshCheck>(),
    onRefreshJob: vi.fn<typeof onRefreshJob>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

interface Reply {
    readonly status: number;
    readonly body: unknown;
}

type Send = (method: "GET" | "POST", path: string, body?: string) => Promise<Reply>;

/** Requests to one app serving the routes, which takes each request's context from `getContext`. */
function serving(getContext: () => DevvitContext): Send {
    const app = createApp(getContext);
    return async (method: "GET" | "POST", path: string, body?: string): Promise<Reply> => {
        const response = await app.request(path, body === undefined ? { method } : { method, body });
        const responseBody: unknown = await response.json();
        return { status: response.status, body: responseBody };
    };
}

interface RouteCase {
    readonly path: string;
    readonly body: Readonly<Record<string, unknown>>;
    /** What the route passes its handler: the body, narrowed where the handler reads fields. */
    readonly event: unknown;
    readonly handlerCalls: () => readonly unknown[];
    /** What a successful run logs. */
    readonly successLogs: readonly (readonly string[])[];
}

const ROUTE_CASES: readonly RouteCase[] = [
    {
        path: "/internal/triggers/mod-action",
        body: { type: "ModAction", action: "wikirevise", moderator: { id: "t2_mod", name: "mod_user" } },
        event: { action: "wikirevise", moderator: { name: "mod_user" } },
        handlerCalls: (): readonly unknown[] => vi.mocked(onModAction).mock.calls,
        successLogs: [],
    },
    {
        path: "/internal/triggers/comment-create",
        body: { type: "CommentCreate", author: { name: "someone" }, post: { id: "t3_alpha", numComments: 42 } },
        event: { author: { name: "someone" }, post: { id: "t3_alpha", numComments: 42 } },
        handlerCalls: (): readonly unknown[] => vi.mocked(onCommentCreate).mock.calls,
        successLogs: [],
    },
    {
        path: "/internal/triggers/post-delete",
        body: { type: "PostDelete", postId: "t3_alpha" },
        event: { postId: "t3_alpha" },
        handlerCalls: (): readonly unknown[] => vi.mocked(onPostDelete).mock.calls,
        successLogs: [],
    },
    {
        path: "/internal/triggers/app-install",
        body: { type: "AppInstall" },
        event: { type: "AppInstall" },
        handlerCalls: (): readonly unknown[] => vi.mocked(onAppInstall).mock.calls,
        successLogs: [["AppInstall trigger finished in 0 ms."]],
    },
    {
        path: "/internal/triggers/app-upgrade",
        body: { type: "AppUpgrade" },
        event: { type: "AppUpgrade" },
        handlerCalls: (): readonly unknown[] => vi.mocked(onAppUpgrade).mock.calls,
        successLogs: [["AppUpgrade trigger finished in 0 ms."]],
    },
    {
        path: "/internal/jobs/refresh",
        body: { name: "RefreshStickyPosts" },
        event: { name: "RefreshStickyPosts" },
        handlerCalls: (): readonly unknown[] => vi.mocked(onRefreshJob).mock.calls,
        successLogs: [["Refresh job finished in 0 ms."]],
    },
    {
        path: "/internal/jobs/refresh-check",
        body: { name: "RefreshCheck" },
        event: { name: "RefreshCheck" },
        handlerCalls: (): readonly unknown[] => vi.mocked(onRefreshCheck).mock.calls,
        successLogs: [["Refresh check finished in 0 ms."]],
    },
];

describe(createApp, (): void => {
    it.for(ROUTE_CASES)(
        "runs $path's handler with its event and the request's context, and answers ok",
        TEST_OPTIONS,
        async (routeCase: RouteCase): Promise<void> => {
            expect.assertions(2);

            const { context } = createFakeDevvitContext();
            const reply = await serving((): DevvitContext => context)(
                "POST",
                routeCase.path,
                JSON.stringify(routeCase.body),
            );

            expect(reply).toStrictEqual({ status: 200, body: { status: "ok" } });
            expect(routeCase.handlerCalls()).toStrictEqual([[routeCase.event, context]]);
        },
    );

    it.for(ROUTE_CASES)(
        "logs a successful run of $path only if its handler runs rarely",
        TEST_OPTIONS,
        async (routeCase: RouteCase): Promise<void> => {
            expect.assertions(1);

            freezeDate("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            const { context } = createFakeDevvitContext();
            await serving((): DevvitContext => context)("POST", routeCase.path, JSON.stringify(routeCase.body));

            expect(logSpy.mock.calls).toStrictEqual(routeCase.successLogs);
        },
    );

    it("answers a handler's failure with a bare HTTP 500, after logging it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeDate("2026-04-21T10:00:00Z");
        const errorSpy = silenceConsole("error");
        const failure = new Error("Reddit is down");
        vi.mocked(onRefreshJob).mockRejectedValue(failure);
        const { context } = createFakeDevvitContext();

        await expect(
            serving((): DevvitContext => context)("POST", "/internal/jobs/refresh", "{}"),
        ).resolves.toStrictEqual({
            status: 500,
            body: { status: "error" },
        });
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith("Refresh job failed after 0 ms:", failure);
    });

    it(
        "treats a request whose context cannot be built as a failure of its handler",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeDate("2026-04-21T10:00:00Z");
            const errorSpy = silenceConsole("error");
            const failure = new Error("No context found.");
            const send = serving((): DevvitContext => {
                throw failure;
            });

            await expect(send("POST", "/internal/triggers/mod-action", "{}")).resolves.toStrictEqual({
                status: 500,
                body: { status: "error" },
            });
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("ModAction trigger failed after 0 ms:", failure);
            expect(vi.mocked(onModAction)).not.toHaveBeenCalled();
        },
    );

    it.for(["not json", "[]", '"text"', "null", "42"])(
        "rejects a body that is not a JSON object (%s) with HTTP 400, without running the handler",
        TEST_OPTIONS,
        async (body: string): Promise<void> => {
            expect.assertions(3);

            const warnSpy = silenceConsole("warn");
            const { context } = createFakeDevvitContext();

            await expect(
                serving((): DevvitContext => context)("POST", "/internal/triggers/mod-action", body),
            ).resolves.toStrictEqual({
                status: 400,
                body: { status: "error" },
            });
            expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
                "Ignoring a request to /internal/triggers/mod-action whose body is not a JSON object.",
            );
            expect(vi.mocked(onModAction)).not.toHaveBeenCalled();
        },
    );

    it.for<readonly ["GET" | "POST", string]>([
        ["POST", "/internal/triggers/unknown"],
        ["POST", "/api/threads"],
        ["POST", "/external/anything"],
        ["GET", "/internal/triggers/mod-action"],
    ])(
        "answers %s %s, which devvit.json does not declare, with HTTP 404",
        TEST_OPTIONS,
        async ([method, path]: readonly ["GET" | "POST", string]): Promise<void> => {
            expect.assertions(1);

            const { context } = createFakeDevvitContext();

            await expect(serving((): DevvitContext => context)(method, path)).resolves.toStrictEqual({
                status: 404,
                body: {},
            });
        },
    );

    it(
        "builds each request's context while serving it, so overlapping requests never share one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const first = createFakeDevvitContext("firstsub").context;
            const second = createFakeDevvitContext("secondsub").context;
            const getContext = vi.fn<() => DevvitContext>().mockReturnValueOnce(first).mockReturnValueOnce(second);
            const send = serving(getContext);

            await Promise.all([
                send("POST", "/internal/jobs/refresh", "{}"),
                send("POST", "/internal/jobs/refresh", "{}"),
            ]);

            expect(
                new Set(
                    vi
                        .mocked(onRefreshJob)
                        .mock.calls.map(([, context]: readonly [unknown, unknown]): unknown => context),
                ),
            ).toStrictEqual(new Set([first, second]));
        },
    );
});
