import { describe, expect, it } from "vitest";
import { createConfigPageFakes } from "../../tests/support/fakeConfigPageContext.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { applyConfigPageRevision } from "./configPageRevision.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(applyConfigPageRevision, (): void => {
    it("logs and reports the page unavailable when it cannot be fetched", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const errorSpy = silenceConsole("error");
        const pageError = new Error("wiki unavailable");
        const fakes = createConfigPageFakes({ pageError });

        await expect(applyConfigPageRevision("mod_user", fakes.context)).resolves.toBe("unavailable");
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "Failed to fetch wiki page stickymgr/config in subreddit testsub:",
            pageError,
        );
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("logs and reports no change when the revision was already accepted", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const logSpy = silenceConsole("log");
        const fakes = createConfigPageFakes({ lastRevision: "rev-2" });

        await expect(applyConfigPageRevision("mod_user", fakes.context)).resolves.toBe("unchanged");
        expect(fakes.redisGet).toHaveBeenCalledExactlyOnceWith("LastRevision");
        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "No changes detected in wiki page stickymgr/config in subreddit testsub.",
        );
        expect(fakes.redisSet).not.toHaveBeenCalled();
    });

    it("stores the revision's thread configs and records the revision", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(5);

        const fakes = createConfigPageFakes({ lastRevision: "rev-1" });

        await expect(applyConfigPageRevision("mod_user", fakes.context)).resolves.toBe("stored");
        expect(fakes.redisSet).toHaveBeenNthCalledWith(1, "LastRevision", "rev-2");
        expect(fakes.redisSet).toHaveBeenNthCalledWith(
            2,
            "Configuration",
            JSON.stringify([
                {
                    name: "daily-thread",
                    enabled: true,
                    title: "Daily thread",
                    frequency: "daily",
                    postTime: "12:30",
                    sticky: true,
                    maxComments: 200,
                    body: "Hello world\n",
                },
            ]),
        );
        expect(fakes.redisDel).toHaveBeenCalledExactlyOnceWith("UnreadableConfigAlertSent");
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("stores keys left empty in YAML as null", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createConfigPageFakes({
            pageContent: [
                "name: cap-thread",
                "enabled: true",
                "title: Cap",
                "maxComments: 5",
                "body: b",
                "endNote:",
            ].join("\n"),
        });

        await expect(applyConfigPageRevision("mod_user", fakes.context)).resolves.toBe("stored");
        expect(fakes.redisSet).toHaveBeenNthCalledWith(
            2,
            "Configuration",
            JSON.stringify([
                { name: "cap-thread", enabled: true, title: "Cap", maxComments: 5, body: "b", endNote: null },
            ]),
        );
    });
});
