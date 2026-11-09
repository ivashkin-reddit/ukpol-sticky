import { redis } from "@devvit/web/server";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import {
    checkRefreshes,
    refreshThreadConfig,
    requestEveryThreadRefresh,
    startRefreshCheck,
} from "../src/rotation/index.js";
import { HARNESS_CONTEXT, listRefreshCheckCrons, listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
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
};

async function refreshJobRunTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map(({ runAt }: Readonly<{ runAt: Date }>): string => runAt.toISOString());
}

async function refreshJobIds(): Promise<string[]> {
    return (await listRefreshJobs()).map(({ id }: Readonly<{ id: string }>): string => id);
}

/** At 10:43, the daily thread config stored and applied, with its live post published at 05:00. */
async function dailyThreadAt1043(): Promise<void> {
    freezeTime("2026-04-21T10:43:00Z");
    silenceConsole("log");
    await storeThreadConfigs([DAILY_CONFIG], configReadPorts(HARNESS_CONTEXT));
    const ports = rotationPorts(HARNESS_CONTEXT);
    await Promise.all(
        (await ports.threadConfigs()).map(async (config: ThreadConfig): Promise<void> => {
            await ports.appliedThreadConfigs.record(config);
        }),
    );
    const postId = await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Daily body");
    vi.setSystemTime(new Date("2026-04-21T10:43:00Z"));
    await redis.hSet("StickyPostStore", { "daily-thread": postId });
}

describe("the refresh check", (): void => {
    devvitIt("is scheduled once, hourly, however often it is started", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { refreshJobs } = rotationPorts(HARNESS_CONTEXT);
        await startRefreshCheck(refreshJobs);
        await startRefreshCheck(refreshJobs);

        await expect(listRefreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
    });

    devvitIt(
        "requests a refresh of a thread config with a schedule and none pending",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            await dailyThreadAt1043();
            silenceConsole("error");

            await checkRefreshes(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobRunTimes()).resolves.toStrictEqual(["2026-04-21T10:43:01.000Z"]);
        },
    );

    devvitIt("leaves an on-time refresh alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await dailyThreadAt1043();
        const ports = rotationPorts(HARNESS_CONTEXT);
        await requestEveryThreadRefresh(ports, "thread configs stored since the last refresh");
        const pendingIds = await refreshJobIds();

        await checkRefreshes(ports);

        await expect(refreshJobIds()).resolves.toStrictEqual(pendingIds);
    });

    devvitIt(
        "replaces a refresh that was due an hour ago and never ran with exactly one new refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            await dailyThreadAt1043();
            silenceConsole("error");
            const ports = rotationPorts(HARNESS_CONTEXT);
            await requestEveryThreadRefresh(ports, "thread configs stored since the last refresh");
            vi.setSystemTime(new Date("2026-04-21T11:43:00Z"));

            await checkRefreshes(ports);

            await expect(refreshJobRunTimes()).resolves.toStrictEqual(["2026-04-21T11:43:01.000Z"]);
        },
    );

    devvitIt("is started again by a refresh that finds it gone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await dailyThreadAt1043();
        silenceConsole("error");

        await refreshThreadConfig("daily-thread", rotationPorts(HARNESS_CONTEXT));

        await expect(listRefreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
    });
});
