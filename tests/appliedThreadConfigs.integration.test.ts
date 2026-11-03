import { asT3ID } from "@devvit/public-api/types/tid.js";
import { reddit } from "@devvit/reddit";
import { redis } from "@devvit/redis";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { ensureRefreshPending, refreshAllThreads, requestRefresh, scheduleNextRefresh } from "../src/rotation/index.js";
import { HARNESS_CONTEXT, listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

const DAILY_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    frequency: "daily",
    postTime: "12:30",
    maxComments: 200,
    body: "Daily body",
    sticky: true,
};

const EDITED_CONFIG: ThreadConfig = { ...DAILY_CONFIG, body: "Edited body" };

async function refreshJobTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map((job: Readonly<{ runAt: Date }>): string => job.runAt.toISOString());
}

async function refreshJobIds(): Promise<string[]> {
    return (await listRefreshJobs()).map((job: Readonly<{ id: string }>): string => job.id);
}

/**
 * At 10:00, a refresh has applied DAILY_CONFIG to its live post, published at 05:00, so the next refresh is due at its
 * 12:30 rotation. Returns the live post's ID.
 */
async function refreshedDailyThread(): Promise<string> {
    freezeTime("2026-04-21T10:00:00Z");
    silenceConsole("log");
    await storeThreadConfigs([DAILY_CONFIG], configReadPorts(HARNESS_CONTEXT));
    const postId = await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Daily body");
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
    await redis.hSet("StickyPostStore", { "daily-thread": postId });
    await refreshAllThreads(rotationPorts(HARNESS_CONTEXT));
    return postId;
}

describe("thread configs stored since the last refresh", (): void => {
    devvitIt(
        "keep a refresh due at once when the next refresh is rescheduled before the requested one runs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            await refreshedDailyThread();

            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);

            // A moderator saves a new body: it is stored, and a refresh is requested to apply it.
            await storeThreadConfigs([EDITED_CONFIG], configReadPorts(HARNESS_CONTEXT));
            await requestRefresh(rotationPorts(HARNESS_CONTEXT));
            // Before that refresh runs, another invocation reschedules, as a comment-cap rotation does when it ends.
            await scheduleNextRefresh(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T10:00:05.000Z"]);
        },
    );

    devvitIt(
        "are applied by the next refresh, which then schedules the one after for the rotation time",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const postId = await refreshedDailyThread();
            await storeThreadConfigs([EDITED_CONFIG], configReadPorts(HARNESS_CONTEXT));

            await refreshAllThreads(rotationPorts(HARNESS_CONTEXT));

            await expect(reddit.getPostById(asT3ID(postId))).resolves.toHaveProperty("body", "Edited body");
            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
        },
    );

    devvitIt(
        "are taken to be unapplied while no refresh has recorded what it applied, as after an upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            await refreshedDailyThread();
            // Live state from a version that did not record the applied thread configs.
            await redis.del("AppliedThreadConfigs");

            await scheduleNextRefresh(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T10:00:05.000Z"]);
        },
    );
});

describe("the refresh check, with thread configs stored since the last refresh", (): void => {
    devvitIt(
        "requests a refresh when the one their save requested was never scheduled",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            await refreshedDailyThread();
            const errorSpy = silenceConsole("error");
            // A save stored them, but its request for a refresh failed, leaving the 12:30 rotation as the only refresh.
            await storeThreadConfigs([EDITED_CONFIG], configReadPorts(HARNESS_CONTEXT));
            vi.setSystemTime(new Date("2026-04-21T10:43:00Z"));

            await ensureRefreshPending(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T10:43:01.000Z"]);
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "Thread configs stored since the last refresh had no refresh due at once, so the refresh check requested one.",
            );
        },
    );

    devvitIt("leaves alone the refresh their save requested", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await refreshedDailyThread();
        await storeThreadConfigs([EDITED_CONFIG], configReadPorts(HARNESS_CONTEXT));
        await requestRefresh(rotationPorts(HARNESS_CONTEXT));
        const pendingIds = await refreshJobIds();
        // The check runs before Devvit has run the requested refresh.
        vi.setSystemTime(new Date("2026-04-21T10:00:30Z"));

        await ensureRefreshPending(rotationPorts(HARNESS_CONTEXT));

        await expect(refreshJobIds()).resolves.toStrictEqual(pendingIds);
    });
});
