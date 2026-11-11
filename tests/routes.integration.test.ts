import { reddit, redis } from "@devvit/web/server";
import { T3 as asPostId } from "@devvit/web/shared";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { startRefreshCheck } from "../src/rotation/index.js";
import { listRefreshCheckCrons, listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeDate } from "./support/fakeClock.js";
import { VALID_CONFIG_PAGE } from "./support/fakeConfigurationPorts.js";
import { createHarnessWorld } from "./support/harnessWorld.js";
import type { HarnessWorld } from "./support/harnessWorld.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

// Devvit may deliver any event or task more than once. Each test delivers one twice through its route and checks that
// the app ends as if it had come once: the same stored state, the same pending jobs, and no moderator alert.

const DAILY_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    frequency: "daily",
    postTime: "12:30",
    maxComments: 200,
    body: "Hello world",
    sticky: true,
};

async function refreshJobTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map((job: Readonly<{ runAt: Date }>): string => job.runAt.toISOString());
}

/** A world at 10:00 whose daily thread config is stored, with its live post published at 05:00. */
async function worldWithLivePost(): Promise<Readonly<{ world: HarnessWorld; postId: string }>> {
    freezeDate("2026-04-21T10:00:00Z");
    silenceConsole("log");
    const world = createHarnessWorld(VALID_CONFIG_PAGE);
    await storeThreadConfigs([DAILY_CONFIG], configReadPorts(world.context));
    const postId = await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Hello world");
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
    await rotationPorts(world.context).livePosts.set("daily-thread", postId);
    return { world, postId };
}

describe("events and tasks delivered twice", (): void => {
    devvitIt(
        "a wiki revision's ModAction stores its thread configs once and leaves one refresh pending",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            freezeDate("2026-04-21T10:00:00Z");
            const logSpy = silenceConsole("log");
            const world = createHarnessWorld(VALID_CONFIG_PAGE);
            const revision = { type: "ModAction", action: "wikirevise", moderator: { name: "mod_user" } };

            await expect(world.deliverTwice("/internal/triggers/mod-action", revision)).resolves.toStrictEqual([
                200, 200,
            ]);
            expect(
                logSpy.mock.calls.filter(
                    ([message]: readonly unknown[]): boolean =>
                        message === "Accepted config page revision rev-1: 1 thread configs.",
                ),
            ).toHaveLength(1);
            expect(logSpy).toHaveBeenCalledWith("Config page revision rev-1 is already accepted.");
            await expect(listRefreshJobs()).resolves.toHaveLength(1);
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt(
        "a CommentCreate below the comment cap leaves the live post alone",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { world, postId } = await worldWithLivePost();
            await redis.set(`CommentCap:${postId}`, "200");
            // A count this near the cap makes the rotation read the post's own count, which is below it.
            const comment = {
                type: "CommentCreate",
                author: { name: "someone" },
                post: { id: postId, numComments: 199 },
            };

            await expect(world.deliverTwice("/internal/triggers/comment-create", comment)).resolves.toStrictEqual([
                200, 200,
            ]);
            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "daily-thread": postId });
            expect(world.submitPost).not.toHaveBeenCalled();
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt("a PostDelete forgets the deleted live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { world, postId } = await worldWithLivePost();

        await expect(
            world.deliverTwice("/internal/triggers/post-delete", { type: "PostDelete", postId }),
        ).resolves.toStrictEqual([200, 200]);
        await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({});
    });

    devvitIt(
        "an AppInstall writes the config page once and starts one hourly check",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            freezeDate("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const world = createHarnessWorld(undefined);

            await expect(
                world.deliverTwice("/internal/triggers/app-install", { type: "AppInstall" }),
            ).resolves.toStrictEqual([200, 200]);
            // One write: the page's only revision is the template the first install wrote, which the second kept.
            await expect(redis.get("LastRevision")).resolves.toBe("rev-1");
            await expect(listRefreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
            // The template holds no thread configs, so there is no thread config to refresh.
            await expect(listRefreshJobs()).resolves.toStrictEqual([]);
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt(
        "an AppUpgrade leaves one hourly check and one pending refresh per thread config",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            freezeDate("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const world = createHarnessWorld(VALID_CONFIG_PAGE);

            await expect(
                world.deliverTwice("/internal/triggers/app-upgrade", { type: "AppUpgrade" }),
            ).resolves.toStrictEqual([200, 200]);
            await expect(listRefreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
            await expect(listRefreshJobs()).resolves.toHaveLength(1);
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt(
        "the refresh job keeps a live post that is not yet due and its next refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { world, postId } = await worldWithLivePost();
            await startRefreshCheck(rotationPorts(world.context).refreshJobs);

            await expect(
                world.deliverTwice("/internal/jobs/refresh", {
                    name: "RefreshStickyPosts",
                    data: { configName: "daily-thread" },
                }),
            ).resolves.toStrictEqual([200, 200]);
            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "daily-thread": postId });
            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
            expect(world.submitPost).not.toHaveBeenCalled();
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt(
        "a refresh job from before the upgrade requests one refresh of each thread config",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { world } = await worldWithLivePost();

            await expect(
                world.deliverTwice("/internal/jobs/refresh", { name: "RefreshStickyPosts" }),
            ).resolves.toStrictEqual([200, 200]);
            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T10:00:01.000Z"]);
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt("the refresh check leaves one pending refresh", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(4);

        freezeDate("2026-04-21T10:43:00Z");
        silenceConsole("log");
        const world = createHarnessWorld(VALID_CONFIG_PAGE);

        await expect(
            world.deliverTwice("/internal/jobs/refresh-check", { name: "RefreshCheck" }),
        ).resolves.toStrictEqual([200, 200]);
        await expect(listRefreshJobs()).resolves.toHaveLength(1);
        await expect(redis.get("LastRevision")).resolves.toBe("rev-1");
        expect(world.createModInboxConversation).not.toHaveBeenCalled();
    });
});

describe("the status's routes", (): void => {
    devvitIt(
        "the menu item shows a moderator the stored state, the same each time",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { world } = await worldWithLivePost();
            await startRefreshCheck(rotationPorts(world.context).refreshJobs);
            const menuItem = { location: "subreddit", targetId: "t5_testsub" };

            const first = await world.deliver("/internal/menu/status", menuItem);
            const second = await world.deliver("/internal/menu/status", menuItem);

            expect(first.status).toBe(200);
            // The daily thread config was stored without a refresh applying it, so the refresh check would request one.
            expect(first.body).toHaveProperty(
                ["showForm", "form", "fields", 0, "defaultValue"],
                "1 managed thread: 0 running, 1 needs attention.",
            );
            expect(second).toStrictEqual(first);
            expect(world.createModInboxConversation).not.toHaveBeenCalled();
        },
    );

    devvitIt("the menu item refuses a user who is not a moderator", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeDate("2026-04-21T10:00:00Z");
        silenceConsole("warn");
        const world = createHarnessWorld(VALID_CONFIG_PAGE, { username: "someone", moderator: false });

        await expect(world.deliver("/internal/menu/status", {})).resolves.toStrictEqual({
            status: 200,
            body: { showToast: "Only moderators of r/testsub can see Sticky Manager's status." },
        });
    });

    devvitIt("the form opens the chosen live post, the same each time", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { world, postId } = await worldWithLivePost();
        const { permalink } = await reddit.getPostById(asPostId(postId));
        const choice = { threadConfig: ["daily-thread"] };
        const opened = { status: 200, body: { navigateTo: `https://www.reddit.com${permalink}` } };

        await expect(world.deliver("/internal/forms/status", choice)).resolves.toStrictEqual(opened);
        await expect(world.deliver("/internal/forms/status", choice)).resolves.toStrictEqual(opened);
    });
});
