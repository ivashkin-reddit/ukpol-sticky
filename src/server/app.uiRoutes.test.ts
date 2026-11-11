import { describe, expect, it, vi } from "vitest";
import { freezeDate } from "../../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../../tests/support/fakeDevvitContext.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { DevvitContext } from "../composition.js";
import { onStatusForm, onStatusMenu } from "../status.js";
import type * as Status from "../status.js";
import { createApp } from "./app.js";

// The routes for moderators' actions in Reddit's UI: the status's menu item and form.

vi.mock(import("../status.js"), (): Partial<typeof Status> => ({
    onStatusForm: vi.fn<typeof onStatusForm>(),
    onStatusMenu: vi.fn<typeof onStatusMenu>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

interface Reply {
    readonly status: number;
    readonly body: unknown;
}

/** Posts `body` to `path` on an app serving the routes with `context`. */
async function post(context: DevvitContext, path: string, body: string): Promise<Reply> {
    const response = await createApp((): DevvitContext => context).request(path, { method: "POST", body });
    const responseBody: unknown = await response.json();
    return { status: response.status, body: responseBody };
}

interface UiRouteCase {
    readonly path: string;
    readonly name: string;
    readonly body: Readonly<Record<string, unknown>>;
    /** What the route passes its handler: the body, narrowed where the handler reads fields. */
    readonly event: unknown;
    /** Makes the route's handler answer with a toast saying `text`. */
    readonly answer: (text: string) => void;
    readonly fail: (failure: Readonly<Error>) => void;
    readonly handlerCalls: () => readonly unknown[];
}

const UI_ROUTE_CASES: readonly UiRouteCase[] = [
    {
        path: "/internal/menu/status",
        name: "Status menu",
        body: { location: "subreddit", targetId: "t5_testsub" },
        event: { location: "subreddit", targetId: "t5_testsub" },
        answer: (text: string): void => {
            vi.mocked(onStatusMenu).mockResolvedValue({ showToast: text });
        },
        fail: (failure: Readonly<Error>): void => {
            vi.mocked(onStatusMenu).mockRejectedValue(failure);
        },
        handlerCalls: (): readonly unknown[] => vi.mocked(onStatusMenu).mock.calls,
    },
    {
        path: "/internal/forms/status",
        name: "Status form",
        body: { "threadConfig": ["daily-thread"], "thread-1-live-post": "anything a client sends" },
        event: { configName: "daily-thread" },
        answer: (text: string): void => {
            vi.mocked(onStatusForm).mockResolvedValue({ showToast: text });
        },
        fail: (failure: Readonly<Error>): void => {
            vi.mocked(onStatusForm).mockRejectedValue(failure);
        },
        handlerCalls: (): readonly unknown[] => vi.mocked(onStatusForm).mock.calls,
    },
];

describe("the UI routes", (): void => {
    it.for(UI_ROUTE_CASES)(
        "answers $path with what its handler answers, run with its event and the request's context, and logs the run",
        TEST_OPTIONS,
        async (routeCase: UiRouteCase): Promise<void> => {
            expect.assertions(3);

            freezeDate("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            routeCase.answer("shown");
            const { context } = createFakeDevvitContext();

            const reply = await post(context, routeCase.path, JSON.stringify(routeCase.body));

            expect(reply).toStrictEqual({ status: 200, body: { showToast: "shown" } });
            expect(routeCase.handlerCalls()).toStrictEqual([[routeCase.event, context]]);
            expect(logSpy.mock.calls).toStrictEqual([[`${routeCase.name} finished in 0 ms.`]]);
        },
    );

    it.for(UI_ROUTE_CASES)(
        "answers a failure of $path with a fixed message and no detail, after logging it",
        TEST_OPTIONS,
        async (routeCase: UiRouteCase): Promise<void> => {
            expect.assertions(2);

            freezeDate("2026-04-21T10:00:00Z");
            const errorSpy = silenceConsole("error");
            const failure = new Error("Reddit is down");
            routeCase.fail(failure);
            const { context } = createFakeDevvitContext();

            await expect(post(context, routeCase.path, JSON.stringify(routeCase.body))).resolves.toStrictEqual({
                status: 200,
                body: { showToast: "Sticky Manager could not show its status. Try again shortly." },
            });
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(`${routeCase.name} failed after 0 ms:`, failure);
        },
    );

    it(
        "rejects a status form body that is not a JSON object with HTTP 400, without running the handler",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const warnSpy = silenceConsole("warn");
            const { context } = createFakeDevvitContext();

            await expect(post(context, "/internal/forms/status", "[]")).resolves.toStrictEqual({
                status: 400,
                body: { status: "error" },
            });
            expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
                "Ignoring a request to /internal/forms/status whose body is not a JSON object.",
            );
            expect(vi.mocked(onStatusForm)).not.toHaveBeenCalled();
        },
    );
});
