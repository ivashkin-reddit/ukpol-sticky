import { afterEach, vi } from "vitest";
import { getConfig, handleWikiUpdate } from "./config.js";
import { ScheduledJob } from "./constants.js";
import { refreshStickyPosts } from "./stickyManager.js";

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

afterEach(() => {
    vi.useRealTimers();
});

function createWikiUpdateContext (overrides?: {
    lastRevision?: string | null;
    revisionId?: string;
    scheduledJobs?: { id: string; name: string }[];
    subredditId?: string;
    subredditName?: string;
    wikiContent?: string;
    wikiError?: Error;
}) {
    const getWikiPage = overrides?.wikiError
        ? vi.fn().mockRejectedValue(overrides.wikiError)
        : vi.fn().mockResolvedValue({ content: overrides?.wikiContent ?? VALID_WIKI_CONTENT, revisionId: overrides?.revisionId ?? "rev-2" });

    const redis = {
        get: vi.fn().mockResolvedValue(overrides?.lastRevision ?? null),
        set: vi.fn().mockResolvedValue(undefined),
    };

    const reddit = {
        getCurrentSubredditName: vi.fn().mockResolvedValue(overrides?.subredditName ?? "testsub"),
        getWikiPage,
        modMail: {
            createModInboxConversation: vi.fn().mockResolvedValue(undefined),
        },
    };

    const scheduler = {
        cancelJob: vi.fn().mockResolvedValue(undefined),
        listJobs: vi.fn().mockResolvedValue(overrides?.scheduledJobs ?? []),
        runJob: vi.fn().mockResolvedValue(undefined),
    };

    return {
        context: {
            redis,
            reddit,
            scheduler,
            subredditId: overrides?.subredditId ?? "t5_testsub",
            subredditName: overrides?.subredditName ?? "testsub",
        },
        redis,
        reddit,
        scheduler,
    };
}

function createWikiUpdateEvent (overrides?: {
    action?: string;
    moderatorName?: string | undefined;
}) {
    return {
        action: overrides?.action ?? "wikirevise",
        moderator: overrides?.moderatorName === undefined ? { name: "mod_user" } : { name: overrides.moderatorName },
    };
}

test("getConfig returns an empty array when no config is stored", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const context = {
        redis: {
            get: vi.fn().mockResolvedValue(null),
        },
    };

    await expect(getConfig(context as never)).resolves.toEqual([]);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
});

test("getConfig returns an empty array when stored JSON is invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const context = {
        redis: {
            get: vi.fn().mockResolvedValue("{"),
        },
    };

    await expect(getConfig(context as never)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("getConfig returns an empty array when stored JSON is not an array", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const context = {
        redis: {
            get: vi.fn().mockResolvedValue("{}"),
        },
    };

    await expect(getConfig(context as never)).resolves.toEqual([]);
    expect(errorSpy).toHaveBeenCalledWith("Stored configuration is not an array. Returning empty config.");

    errorSpy.mockRestore();
});

test("handleWikiUpdate ignores non-wiki revision actions", async () => {
    const { context, reddit, redis, scheduler } = createWikiUpdateContext();

    await handleWikiUpdate(createWikiUpdateEvent({ action: "approvelink" }) as never, context as never);

    expect(redis.get).not.toHaveBeenCalled();
    expect(reddit.getWikiPage).not.toHaveBeenCalled();
    expect(reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
});

test("handleWikiUpdate logs and returns when the moderator name is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { context, reddit, redis, scheduler } = createWikiUpdateContext();

    await handleWikiUpdate({ action: "wikirevise" }, context as never);

    expect(errorSpy).toHaveBeenCalledWith("Moderator name is missing in the event.");
    expect(redis.get).not.toHaveBeenCalled();
    expect(reddit.getWikiPage).not.toHaveBeenCalled();
    expect(reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("handleWikiUpdate reports invalid config schema without persisting it", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiContent: [
            "name: invalid-thread",
            "enabled: true",
            "title: Invalid thread",
            "maxComments: 0",
            "body: bad",
        ].join("\n"),
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).toHaveBeenCalledWith(expect.objectContaining({
        subject: "Invalid config in wiki page stickymgr/config",
    }));
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("handleWikiUpdate reports incomplete schedules without persisting config", async () => {
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiContent: [
            "name: incomplete-thread",
            "enabled: true",
            "title: Incomplete thread",
            "frequency: daily",
            "maxComments: 200",
            "body: hello",
        ].join("\n"),
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).toHaveBeenCalledWith(expect.objectContaining({
        subject: "Incomplete schedule in config incomplete-thread",
    }));
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
});

test("handleWikiUpdate ignores unchanged wiki revisions", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        lastRevision: "rev-2",
        revisionId: "rev-2",
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(redis.get).toHaveBeenCalledWith("LastRevision");
    expect(reddit.getWikiPage).toHaveBeenCalledTimes(1);
    expect(reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalled();

    logSpy.mockRestore();
});

test("handleWikiUpdate logs and returns when fetching the wiki page fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const wikiError = new Error("wiki unavailable");
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiError,
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(redis.get).toHaveBeenCalledWith("LastRevision");
    expect(reddit.getWikiPage).toHaveBeenCalledTimes(1);
    expect(reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("handleWikiUpdate reports invalid YAML without persisting config", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiContent: [
            "name: broken-thread",
            "enabled: true",
            "title: Broken thread",
            "body: \"unterminated",
        ].join("\n"),
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).toHaveBeenCalledWith(expect.objectContaining({
        subject: "Invalid YAML in wiki page stickymgr/config",
    }));
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("handleWikiUpdate reports duplicate config names without persisting config", async () => {
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiContent: [
            "name: duplicate-thread",
            "enabled: true",
            "title: First thread",
            "maxComments: 200",
            "body: first",
            "---",
            "name: duplicate-thread",
            "enabled: true",
            "title: Second thread",
            "maxComments: 300",
            "body: second",
        ].join("\n"),
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).toHaveBeenCalledWith(expect.objectContaining({
        subject: "Duplicate config names in wiki page stickymgr/config",
    }));
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
});

test("handleWikiUpdate reports invalid date formats without persisting config", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        wikiContent: [
            "name: dated-thread",
            "enabled: true",
            "title: Daily {{date nope}}",
            "maxComments: 200",
            "body: hello",
        ].join("\n"),
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).toHaveBeenCalledWith(expect.objectContaining({
        subject: "Invalid date format in config dated-thread",
    }));
    expect(redis.set).not.toHaveBeenCalled();
    expect(scheduler.runJob).not.toHaveBeenCalled();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
});

test("handleWikiUpdate persists valid config and schedules a refresh", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    const { context, reddit, redis, scheduler } = createWikiUpdateContext({
        lastRevision: "rev-1",
        scheduledJobs: [
            { id: "refresh-1", name: ScheduledJob.RefreshStickyPosts },
            { id: "other-1", name: "keep-me" },
        ],
    });

    await handleWikiUpdate(createWikiUpdateEvent() as never, context as never);

    expect(reddit.modMail.createModInboxConversation).not.toHaveBeenCalled();
    expect(redis.set).toHaveBeenNthCalledWith(1, "LastRevision", "rev-2");
    expect(redis.set).toHaveBeenNthCalledWith(2, "Configuration", expect.any(String));
    expect(scheduler.listJobs).toHaveBeenCalledTimes(1);
    expect(scheduler.cancelJob).toHaveBeenCalledWith("refresh-1");
    expect(scheduler.cancelJob).toHaveBeenCalledTimes(1);

    const storedConfigCall = redis.set.mock.calls[1] as [string, string] | undefined;
    expect(JSON.parse(storedConfigCall?.[1] ?? "[]")).toEqual([
        {
            body: "Hello world\n",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "daily-thread",
            postTime: "12:30",
            sticky: true,
            title: "Daily thread",
        },
    ]);
    expect(scheduler.runJob).toHaveBeenCalledWith({
        name: ScheduledJob.RefreshStickyPosts,
        runAt: new Date("2026-04-21T10:00:01.000Z"),
    });
});

test("refreshStickyPosts clears tracked posts when config is empty", async () => {
    const redis = {
        get: vi.fn().mockResolvedValue("[]"),
        hGetAll: vi.fn().mockResolvedValue({
            alpha: "t3_alpha",
            beta: "t3_beta",
        }),
        hDel: vi.fn().mockResolvedValue(undefined),
        del: vi.fn().mockResolvedValue(undefined),
    };

    const context = {
        redis,
    };

    await refreshStickyPosts({} as never, context as never);

    expect(redis.hDel).toHaveBeenCalledWith("StickyPostStore", ["alpha", "beta"]);
    expect(redis.del).toHaveBeenNthCalledWith(1, "CommentCap:t3_alpha");
    expect(redis.del).toHaveBeenNthCalledWith(2, "CommentCap:t3_beta");
});
