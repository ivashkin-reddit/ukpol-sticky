import { describe, expect, it } from "vitest";
import { freezeTime } from "../tests/support/fakeClock.js";
import { createWikiFakes, WIKI_REVISION_EVENT } from "../tests/support/fakeWikiContext.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { REFRESH_STICKY_POSTS_JOB } from "./constants.js";
import { handleWikiUpdate } from "./wikiConfig.js";
import type { WikiUpdateEvent } from "./wikiConfig.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(handleWikiUpdate, (): void => {
    it("ignores mod actions other than wiki revisions", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createWikiFakes();
        await handleWikiUpdate({ action: "approvelink", moderator: { name: "mod_user" } }, fakes.context);

        expect(fakes.redisGet).not.toHaveBeenCalled();
        expect(fakes.getWikiPage).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it.for<WikiUpdateEvent>([{ action: "wikirevise" }, { action: "wikirevise", moderator: { name: "" } }])(
        "logs and stops when the revising moderator is missing (%j)",
        TEST_OPTIONS,
        async (event: WikiUpdateEvent): Promise<void> => {
            expect.assertions(3);

            const errorSpy = silenceConsole("error");
            const fakes = createWikiFakes();
            await handleWikiUpdate(event, fakes.context);

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("Moderator name is missing in the event.");
            expect(fakes.redisGet).not.toHaveBeenCalled();
            expect(fakes.getWikiPage).not.toHaveBeenCalled();
        },
    );

    it("logs and stops when the wiki page cannot be fetched", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const errorSpy = silenceConsole("error");
        const wikiError = new Error("wiki unavailable");
        const fakes = createWikiFakes({ wikiError });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "Failed to fetch wiki page stickymgr/config in subreddit testsub:",
            wikiError,
        );
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("logs and stops when the revision is the one already stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const logSpy = silenceConsole("log");
        const fakes = createWikiFakes({ lastRevision: "rev-2" });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.redisGet).toHaveBeenCalledExactlyOnceWith("LastRevision");
        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "No changes detected in wiki page stickymgr/config in subreddit testsub.",
        );
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it(
        "stores a valid config, replaces pending refresh jobs and schedules one a second later",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = createWikiFakes({
                lastRevision: "rev-1",
                scheduledJobs: [
                    { id: "refresh-1", name: REFRESH_STICKY_POSTS_JOB },
                    { id: "other-1", name: "keep-me" },
                ],
            });
            await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

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
            expect(fakes.cancelJob).toHaveBeenCalledExactlyOnceWith("refresh-1");
            expect(fakes.runJob).toHaveBeenCalledExactlyOnceWith({
                name: REFRESH_STICKY_POSTS_JOB,
                runAt: new Date("2026-04-21T10:00:01.000Z"),
            });
            expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    it("stores keys left empty in YAML as null", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createWikiFakes({
            wikiContent: [
                "name: cap-thread",
                "enabled: true",
                "title: Cap",
                "maxComments: 5",
                "body: b",
                "endNote:",
            ].join("\n"),
        });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.redisSet).toHaveBeenNthCalledWith(
            2,
            "Configuration",
            JSON.stringify([
                {
                    name: "cap-thread",
                    enabled: true,
                    title: "Cap",
                    maxComments: 5,
                    body: "b",
                    endNote: null,
                },
            ]),
        );
    });
});
