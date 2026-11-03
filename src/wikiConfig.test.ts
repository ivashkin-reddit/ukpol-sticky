import type { RedisClient, Scheduler as DevvitScheduler } from "@devvit/public-api";
import type { ScheduledJob } from "@devvit/scheduler";
import { describe, expect, it, vi } from "vitest";
import type { Mock, MockInstance } from "vitest";
import { freezeTime } from "../tests/support/fakeClock.js";
import { REFRESH_STICKY_POSTS_JOB } from "./constants.js";
import { handleWikiUpdate } from "./wikiConfig.js";
import type { WikiUpdateContext, WikiUpdateEvent } from "./wikiConfig.js";

const TEST_OPTIONS = { timeout: 1000 };

const WIKI_REVISION_EVENT: WikiUpdateEvent = { action: "wikirevise", moderator: { name: "mod_user" } };

const VALID_WIKI_CONTENT = [
    "name: daily-thread",
    "enabled: true",
    "title: Daily thread",
    "frequency: daily",
    "postTime: \"12:30\"",
    "sticky: true",
    "maxComments: 200",
    "body: |",
    "  Hello world",
].join("\n");

type CreateModInboxConversation = WikiUpdateContext["reddit"]["modMail"]["createModInboxConversation"];

interface WikiFakes {
    readonly context: WikiUpdateContext;
    readonly cancelJob: Mock<DevvitScheduler["cancelJob"]>;
    readonly createModInboxConversation: Mock<CreateModInboxConversation>;
    readonly getWikiPage: Mock<WikiUpdateContext["reddit"]["getWikiPage"]>;
    readonly redisDel: Mock<RedisClient["del"]>;
    readonly redisGet: Mock<RedisClient["get"]>;
    readonly redisSet: Mock<RedisClient["set"]>;
    readonly runJob: Mock<DevvitScheduler["runJob"]>;
}

type WikiFakeOptions = Readonly<{
    lastRevision?: string;
    scheduledJobs?: readonly Readonly<{ id: string; name: string }>[];
    wikiContent?: string;
    wikiError?: Readonly<Error>;
}>;

function createWikiFakes (options: WikiFakeOptions = {}): WikiFakes {
    const getWikiPage = vi.fn<WikiUpdateContext["reddit"]["getWikiPage"]>();
    if (options.wikiError === undefined) {
        getWikiPage.mockResolvedValue({ content: options.wikiContent ?? VALID_WIKI_CONTENT, revisionId: "rev-2" });
    } else {
        getWikiPage.mockRejectedValue(options.wikiError);
    }

    const redisDel = vi.fn<RedisClient["del"]>().mockResolvedValue(undefined);
    const redisGet = vi.fn<RedisClient["get"]>().mockResolvedValue(options.lastRevision);
    const redisSet = vi.fn<RedisClient["set"]>().mockResolvedValue("OK");
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");
    const cancelJob = vi.fn<DevvitScheduler["cancelJob"]>().mockResolvedValue(undefined);
    const listJobs = vi.fn<DevvitScheduler["listJobs"]>().mockResolvedValue((options.scheduledJobs ?? [])
        .map((job: Readonly<{ id: string; name: string }>): ScheduledJob => ({ ...job, data: undefined, runAt: new Date("2026-04-22T00:00:00Z") })));
    const runJob = vi.fn<DevvitScheduler["runJob"]>().mockResolvedValue("job-id");

    return {
        context: {
            redis: { del: redisDel, get: redisGet, set: redisSet },
            reddit: {
                getCurrentSubredditName: vi.fn<() => Promise<string>>().mockResolvedValue("currentsub"),
                getWikiPage,
                modMail: { createModInboxConversation },
            },
            scheduler: { cancelJob, listJobs, runJob },
            subredditId: "t5_testsub",
            subredditName: "testsub",
        },
        cancelJob,
        createModInboxConversation,
        getWikiPage,
        redisDel,
        redisGet,
        redisSet,
        runJob,
    };
}

function silenceConsole (method: "error" | "log"): MockInstance<(...data: readonly unknown[]) => void> {
    return vi.spyOn(console, method).mockImplementation((): undefined => undefined);
}

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

        expect(errorSpy).toHaveBeenCalledExactlyOnceWith("Failed to fetch wiki page stickymgr/config in subreddit testsub:", wikiError);
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("logs and stops when the revision is the one already stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        const logSpy = silenceConsole("log");
        const fakes = createWikiFakes({ lastRevision: "rev-2" });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.redisGet).toHaveBeenCalledExactlyOnceWith("LastRevision");
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No changes detected in wiki page stickymgr/config in subreddit testsub.");
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("stores a valid config, replaces pending refresh jobs and schedules one a second later", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(5);

        freezeTime("2026-04-21T10:00:00Z");
        const fakes = createWikiFakes({
            lastRevision: "rev-1",
            scheduledJobs: [{ id: "refresh-1", name: REFRESH_STICKY_POSTS_JOB }, { id: "other-1", name: "keep-me" }],
        });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.redisSet).toHaveBeenNthCalledWith(1, "LastRevision", "rev-2");
        expect(fakes.redisSet).toHaveBeenNthCalledWith(2, "Configuration", JSON.stringify([{
            name: "daily-thread",
            enabled: true,
            title: "Daily thread",
            frequency: "daily",
            postTime: "12:30",
            sticky: true,
            maxComments: 200,
            body: "Hello world\n",
        }]));
        expect(fakes.cancelJob).toHaveBeenCalledExactlyOnceWith("refresh-1");
        expect(fakes.runJob).toHaveBeenCalledExactlyOnceWith({ name: REFRESH_STICKY_POSTS_JOB, runAt: new Date("2026-04-21T10:00:01.000Z") });
        expect(fakes.createModInboxConversation).not.toHaveBeenCalled();
    });

    it("stores keys left empty in YAML as null", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createWikiFakes({ wikiContent: ["name: cap-thread", "enabled: true", "title: Cap", "maxComments: 5", "body: b", "endNote:"].join("\n") });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.redisSet).toHaveBeenNthCalledWith(2, "Configuration", JSON.stringify([{
            name: "cap-thread",
            enabled: true,
            title: "Cap",
            maxComments: 5,
            body: "b",
            endNote: null,
        }]));
    });
});

interface ProblemCase {
    readonly problem: string;
    readonly wikiContent: string;
    readonly subject: string;
    readonly errorLogs: readonly (readonly unknown[])[];
}

const PROBLEM_CASES: readonly ProblemCase[] = [
    {
        problem: "invalid YAML",
        wikiContent: ["name: broken-thread", "enabled: true", "title: Broken thread", "body: \"unterminated"].join("\n"),
        subject: "Invalid YAML in wiki page stickymgr/config",
        errorLogs: [[
            "Invalid YAML in wiki page stickymgr/config in subreddit testsub:",
            "Document 1: Missing closing \"quote at line 4, column 20:\n\nbody: \"unterminated\n                   ^\n",
        ]],
    },
    {
        problem: "a schema violation",
        wikiContent: ["name: invalid-thread", "enabled: true", "title: Invalid thread", "maxComments: 0", "body: bad"].join("\n"),
        subject: "Invalid config in wiki page stickymgr/config",
        errorLogs: [["Invalid config in wiki page stickymgr/config in subreddit testsub:", "data/0/maxComments must be >= 1"]],
    },
    {
        problem: "an empty frequency",
        wikiContent: ["name: empty-thread", "enabled: true", "title: Empty", "frequency:", "maxComments: 5", "body: b"].join("\n"),
        subject: "Invalid config in wiki page stickymgr/config",
        errorLogs: [["Invalid config in wiki page stickymgr/config in subreddit testsub:", "data/0/frequency must be equal to one of the allowed values"]],
    },
    {
        problem: "a frequency without a postTime",
        wikiContent: ["name: incomplete-thread", "enabled: true", "title: Incomplete", "frequency: daily", "maxComments: 200", "body: hello"].join("\n"),
        subject: "Incomplete schedule in config incomplete-thread",
        errorLogs: [],
    },
    {
        problem: "an invalid date format",
        wikiContent: ["name: dated-thread", "enabled: true", "title: Daily {{date nope}}", "maxComments: 200", "body: hello"].join("\n"),
        subject: "Invalid date format in config dated-thread",
        errorLogs: [["Invalid date format in config dated-thread:", new RangeError("Format string contains an unescaped latin alphabet character `n`")]],
    },
    {
        problem: "duplicate config names",
        wikiContent: ["name: twin", "enabled: true", "title: One", "maxComments: 1", "body: a", "---", "name: twin", "enabled: true", "title: Two", "maxComments: 2", "body: b"].join("\n"),
        subject: "Duplicate config names in wiki page stickymgr/config",
        errorLogs: [],
    },
];

describe("handleWikiUpdate with an invalid config page", (): void => {
    it.for(PROBLEM_CASES)("reports $problem to modmail and keeps the stored config", TEST_OPTIONS, async (problemCase: ProblemCase): Promise<void> => {
        expect.assertions(4);

        const errorSpy = silenceConsole("error");
        const fakes = createWikiFakes({ wikiContent: problemCase.wikiContent });
        await handleWikiUpdate(WIKI_REVISION_EVENT, fakes.context);

        expect(fakes.createModInboxConversation.mock.lastCall?.[0].subject).toBe(problemCase.subject);
        expect(fakes.createModInboxConversation.mock.lastCall?.[0].subredditId).toBe("t5_testsub");
        expect(fakes.redisSet).not.toHaveBeenCalled();
        expect(errorSpy.mock.calls).toStrictEqual(problemCase.errorLogs);
    });
});
