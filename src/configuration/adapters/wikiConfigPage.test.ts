import { describe, expect, it } from "vitest";
import { createFakeDevvitContext } from "../../../tests/support/fakeDevvitContext.js";
import { silenceConsole } from "../../../tests/support/silenceConsole.js";
import { wikiConfigPage } from "./wikiConfigPage.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe("wikiConfigPage().read", (): void => {
    it("reads the config page's current revision", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeDevvitContext("testsub");
        fakes.reddit.getWikiPage.mockResolvedValue({ content: "name: x", revisionId: "rev-2" });

        await expect(wikiConfigPage(fakes.context).read()).resolves.toStrictEqual({
            content: "name: x",
            revisionId: "rev-2",
            subredditName: "testsub",
        });
        expect(fakes.reddit.getWikiPage).toHaveBeenCalledExactlyOnceWith("testsub", "stickymgr/config");
    });

    it("logs and reads nothing when the page cannot be fetched", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const errorSpy = silenceConsole("error");
        const fakes = createFakeDevvitContext("testsub");
        const pageError = new Error("wiki unavailable");
        fakes.reddit.getWikiPage.mockRejectedValue(pageError);

        await expect(wikiConfigPage(fakes.context).read()).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "Failed to fetch wiki page stickymgr/config in subreddit testsub:",
            pageError,
        );
    });
});

describe("wikiConfigPage().install", (): void => {
    it(
        "writes the page, then lists it and makes it editable by moderators only",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeDevvitContext("testsub");
            await wikiConfigPage(fakes.context).install("# template");

            expect(fakes.reddit.updateWikiPage).toHaveBeenCalledExactlyOnceWith({
                subredditName: "testsub",
                page: "stickymgr/config",
                content: "# template",
            });
            // 2 is WikiPagePermissionLevel.MODS_ONLY.
            expect(fakes.reddit.updateWikiPageSettings).toHaveBeenCalledExactlyOnceWith({
                subredditName: "testsub",
                page: "stickymgr/config",
                permLevel: 2,
                listed: true,
            });
            expect(fakes.reddit.updateWikiPage).toHaveBeenCalledBefore(fakes.reddit.updateWikiPageSettings);
        },
    );
});
