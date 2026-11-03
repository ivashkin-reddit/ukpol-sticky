import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { silenceConsole } from "../../../tests/support/silenceConsole.js";
import { modmailNotifier } from "./modmail.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const ALERT = { subject: "Subject", bodyMarkdown: "Body" };

describe(modmailNotifier, (): void => {
    it(
        "opens a mod inbox conversation in the context's subreddit, and logs it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = silenceConsole("log");
            const fakes = createFakeDevvitContext();
            await modmailNotifier(fakes.context)(ALERT);

            expect(fakes.reddit.modMail.createModInboxConversation).toHaveBeenCalledExactlyOnceWith({
                subredditId: "t5_testsub",
                subject: "Subject",
                bodyMarkdown: "Body",
            });
            expect(logSpy).toHaveBeenCalledExactlyOnceWith("Sent moderator alert by modmail: Subject");
        },
    );

    it("rejects, logging nothing, when modmail cannot be sent", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const logSpy = silenceConsole("log");
        const fakes = createFakeDevvitContext();
        const sendError = new Error("modmail unavailable");
        fakes.reddit.modMail.createModInboxConversation.mockRejectedValue(sendError);

        await expect(modmailNotifier(fakes.context)(ALERT)).rejects.toBe(sendError);
        expect(logSpy).not.toHaveBeenCalled();
    });
});
