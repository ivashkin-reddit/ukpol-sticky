import { describe, expect, it, vi } from "vitest";
import { freezeTime } from "../tests/support/fakeClock.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { observed } from "./observed.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const EVENT = { postId: "t3_alpha" };
const CONTEXT = { subredditName: "testsub" };

type TestHandler = (event: Readonly<typeof EVENT>, context: Readonly<typeof CONTEXT>) => Promise<void>;

/** A handler that takes 25 ms of fake time, then resolves or rejects with `failure`. */
function handlerTaking25Ms(failure?: Readonly<Error>): ReturnType<typeof vi.fn<TestHandler>> {
    return vi.fn<TestHandler>().mockImplementation(async (): Promise<void> => {
        vi.advanceTimersByTime(25);
        await (failure === undefined ? Promise.resolve() : Promise.reject(failure));
    });
}

describe(observed, (): void => {
    it("passes the event and context through to the handler", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const handler = handlerTaking25Ms();
        await observed("Test trigger", "failures only", handler)(EVENT, CONTEXT);

        expect(handler).toHaveBeenCalledExactlyOnceWith(EVENT, CONTEXT);
    });

    it("logs each successful run, with its duration, when asked to", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const logSpy = silenceConsole("log");
        await observed("Refresh job", "every run", handlerTaking25Ms())(EVENT, CONTEXT);

        expect(logSpy).toHaveBeenCalledExactlyOnceWith("Refresh job finished in 25 ms.");
    });

    it("stays quiet on success for a high-volume handler", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const logSpy = silenceConsole("log");
        await observed("CommentCreate trigger", "failures only", handlerTaking25Ms())(EVENT, CONTEXT);

        expect(logSpy).not.toHaveBeenCalled();
    });

    it(
        "logs a failure with the handler's name and duration, then passes it on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const errorSpy = silenceConsole("error");
            const failure = new Error("Reddit is down");

            await expect(
                observed("CommentCreate trigger", "failures only", handlerTaking25Ms(failure))(EVENT, CONTEXT),
            ).rejects.toBe(failure);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("CommentCreate trigger failed after 25 ms:", failure);
        },
    );
});
