import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { modmailNotifier } from "./modmail.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const ALERT = { subject: "Subject", bodyMarkdown: "Body" };

describe(modmailNotifier, (): void => {
    it("opens a mod inbox conversation in the context's subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeDevvitContext();
        await modmailNotifier(fakes.context)(ALERT);

        expect(fakes.reddit.modMail.createModInboxConversation).toHaveBeenCalledExactlyOnceWith({
            subredditId: "t5_testsub",
            subject: "Subject",
            bodyMarkdown: "Body",
        });
    });

    it("rejects when modmail cannot be sent", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeDevvitContext();
        const sendError = new Error("modmail unavailable");
        fakes.reddit.modMail.createModInboxConversation.mockRejectedValue(sendError);

        await expect(modmailNotifier(fakes.context)(ALERT)).rejects.toBe(sendError);
    });
});
