import { describe, expect, it } from "vitest";
import { renderEndNote } from "./endNoteTemplate.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NEW_POST = {
    title: "Daily thread 21/04/2026",
    permalink: "/r/ukpolitics/comments/abc123/daily_thread_21042026/",
};

describe(renderEndNote, (): void => {
    it("returns an end note without the token unchanged", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(renderEndNote("This thread has moved on.", NEW_POST)).toBe("This thread has moved on.");
    });

    it("links the new post, titled with its title, where the token is", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(renderEndNote("Please continue in {{new post}}.", NEW_POST)).toBe(
            "Please continue in [Daily thread 21/04/2026](/r/ukpolitics/comments/abc123/daily_thread_21042026/).",
        );
    });

    it("links the new post at every token", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(renderEndNote("{{new post}} | {{new post}}", NEW_POST)).toBe(
            "[Daily thread 21/04/2026](/r/ukpolitics/comments/abc123/daily_thread_21042026/) | [Daily thread 21/04/2026](/r/ukpolitics/comments/abc123/daily_thread_21042026/)",
        );
    });

    it("escapes the characters that would end or break the link in the new post's title", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const newPost = { ...NEW_POST, title: String.raw`Live: [Budget] \ Q&A` };

        expect(renderEndNote("{{new post}}", newPost)).toBe(
            String.raw`[Live: \[Budget\] \\ Q&A](/r/ukpolitics/comments/abc123/daily_thread_21042026/)`,
        );
    });
});
