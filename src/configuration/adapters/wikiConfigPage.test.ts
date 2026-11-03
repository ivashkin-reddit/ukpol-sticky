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
        });
        expect(fakes.reddit.getWikiPage).toHaveBeenCalledExactlyOnceWith("testsub", "stickymgr/config");
    });

    it("reads who saved the revision, when Reddit says", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeDevvitContext("testsub");
        fakes.reddit.getWikiPage.mockResolvedValue({
            content: "name: x",
            revisionId: "rev-2",
            revisionAuthor: { username: "author_mod" },
        });

        await expect(wikiConfigPage(fakes.context).read()).resolves.toStrictEqual({
            content: "name: x",
            revisionId: "rev-2",
            authorName: "author_mod",
        });
    });

    it("logs and reads nothing when the page cannot be fetched", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const errorSpy = silenceConsole("error");
        const fakes = createFakeDevvitContext("testsub");
        const pageError = new Error("wiki unavailable");
        fakes.reddit.getWikiPage.mockRejectedValue(pageError);

        await expect(wikiConfigPage(fakes.context).read()).resolves.toBeUndefined();
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "Could not read the config page stickymgr/config in r/testsub, so its revision is not applied:",
            pageError,
        );
    });
});

describe("wikiConfigPage().install", (): void => {
    it(
        "writes the template to a page the wiki does not have yet, then lists it and makes it editable by moderators only",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeDevvitContext("testsub");
            fakes.reddit.getWikiPages.mockResolvedValue(["config/sidebar"]);
            await wikiConfigPage(fakes.context).install("# template");

            expect(fakes.reddit.getWikiPage).not.toHaveBeenCalled();
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

    it("writes nothing when the wiki's pages cannot be listed", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeDevvitContext("testsub");
        const listError = new Error("503 Service Unavailable");
        fakes.reddit.getWikiPages.mockRejectedValue(listError);

        await expect(wikiConfigPage(fakes.context).install("# template")).rejects.toBe(listError);
        expect(fakes.reddit.updateWikiPage).not.toHaveBeenCalled();
        expect(fakes.reddit.updateWikiPageSettings).not.toHaveBeenCalled();
    });
});

describe("wikiConfigPage().install on a reinstall", (): void => {
    it(
        "keeps a config page that already has content, still making it editable by moderators only",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const fakes = createFakeDevvitContext("testsub");
            fakes.reddit.getWikiPages.mockResolvedValue(["stickymgr/config"]);
            fakes.reddit.getWikiPage.mockResolvedValue({ content: "name: daily-thread", revisionId: "rev-9" });

            await wikiConfigPage(fakes.context).install("# template");

            expect(fakes.reddit.updateWikiPage).not.toHaveBeenCalled();
            expect(fakes.reddit.updateWikiPageSettings).toHaveBeenCalledExactlyOnceWith({
                subredditName: "testsub",
                page: "stickymgr/config",
                permLevel: 2,
                listed: true,
            });
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Kept the existing content of the config page stickymgr/config.",
            );
        },
    );

    it("writes the template to an empty config page", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeDevvitContext("testsub");
        fakes.reddit.getWikiPages.mockResolvedValue(["stickymgr/config"]);
        fakes.reddit.getWikiPage.mockResolvedValue({ content: "  \n", revisionId: "rev-1" });

        await wikiConfigPage(fakes.context).install("# template");

        expect(fakes.reddit.updateWikiPage).toHaveBeenCalledExactlyOnceWith({
            subredditName: "testsub",
            page: "stickymgr/config",
            content: "# template",
        });
    });

    it("writes nothing when the existing config page cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeDevvitContext("testsub");
        const readError = new Error("503 Service Unavailable");
        fakes.reddit.getWikiPages.mockResolvedValue(["stickymgr/config"]);
        fakes.reddit.getWikiPage.mockRejectedValue(readError);

        // The page holds the moderators' thread configs: replacing it with the template would lose them.
        await expect(wikiConfigPage(fakes.context).install("# template")).rejects.toBe(readError);
        expect(fakes.reddit.updateWikiPage).not.toHaveBeenCalled();
        expect(fakes.reddit.updateWikiPageSettings).not.toHaveBeenCalled();
    });
});
