import { reddit, redis, scheduler } from "@devvit/web/server";
import { T3 as asPostId } from "@devvit/web/shared";
import { describe, expect, vi } from "vitest";
import { configReadPorts, configurationPorts, rotationPorts } from "../src/composition.js";
import { applyConfigPageRevision, storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { REFRESH_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { requestEveryThreadRefresh } from "../src/rotation/index.js";
import type { RotationPorts } from "../src/rotation/index.js";
import { listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeDate } from "./support/fakeClock.js";
import { VALID_CONFIG_PAGE } from "./support/fakeConfigurationPorts.js";
import { createHarnessWorld } from "./support/harnessWorld.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

// The harness cannot distinguish or sticky posts, so these tests rotate nothing: they exercise the refresh jobs, their
// scheduling and the stored state, through the routes Devvit calls.

const WC_NAMES = ["wc-01", "wc-02", "wc-03", "wc-04", "wc-05", "wc-06", "wc-07", "wc-08", "wc-09", "wc-10"];

function wcConfig(name: string): ThreadConfig {
    return {
        name,
        enabled: true,
        title: `TEST worst case ${name}`,
        frequency: "daily",
        postTime: "12:30",
        maxComments: 200,
        body: `Edited body of ${name}`,
    };
}

/** Each pending refresh as "<thread config> <time>", sorted: jobs created in parallel list in any order. */
async function refreshJobs(): Promise<string[]> {
    const jobs = (await listRefreshJobs()).map(
        (job: Readonly<{ runAt: Date; data: Readonly<Record<string, unknown>> | undefined }>): string =>
            `${String(job.data?.["configName"])} ${job.runAt.toISOString()}`,
    );
    return jobs.sort((first: string, second: string): number => first.localeCompare(second));
}

/** Records each stored thread config as applied, as its refresh would. */
async function recordAllApplied(ports: RotationPorts): Promise<void> {
    await Promise.all(
        (await ports.threadConfigs()).map(async (config: ThreadConfig): Promise<void> => {
            await ports.appliedThreadConfigs.record(config);
        }),
    );
}

describe("refreshes per thread config", (): void => {
    devvitIt(
        "give ten thread configs ten jobs, each refreshing only its own thread config in its own request",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeDate("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const world = createHarnessWorld(VALID_CONFIG_PAGE);
            await storeThreadConfigs(WC_NAMES.map(wcConfig), configReadPorts(world.context));
            const entries = await Promise.all(
                WC_NAMES.map(async (name: string): Promise<readonly [string, string]> => [
                    name,
                    await submitPostAt("2026-04-21T05:00:00Z", `TEST worst case ${name}`, "Old body"),
                ]),
            );
            const postIds: Readonly<Record<string, string>> = Object.fromEntries(entries);
            vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
            await redis.hSet("StickyPostStore", postIds);
            await requestEveryThreadRefresh(
                rotationPorts(world.context),
                "thread configs stored since the last refresh",
            );

            const statuses = await Promise.all(
                WC_NAMES.map(
                    async (configName: string): Promise<readonly number[]> =>
                        await world.deliverTwice("/internal/jobs/refresh", {
                            name: REFRESH_JOB_NAME,
                            data: { configName },
                        }),
                ),
            );

            expect(statuses.flat().every((status: number): boolean => status === 200)).toBe(true);
            await expect(reddit.getPostById(asPostId(postIds["wc-07"] ?? ""))).resolves.toHaveProperty(
                "body",
                "Edited body of wc-07",
            );
            await expect(refreshJobs()).resolves.toStrictEqual(
                WC_NAMES.map((name: string): string => `${name} 2026-04-21T12:30:05.000Z`),
            );
        },
    );

    devvitIt(
        "migrate 1.0.3.1's records at the upgrade and keep each thread's rotation time",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            freezeDate("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const world = createHarnessWorld(VALID_CONFIG_PAGE);
            // 1.0.3.1's state: the page accepted and applied, a live post, and its one pending refresh, with no data.
            await applyConfigPageRevision(undefined, configurationPorts(world.context));
            const ports = rotationPorts(world.context);
            await redis.set("AppliedThreadConfigs", JSON.stringify(await ports.threadConfigs()));
            await redis.hSet("RefreshStatus", { lastRefreshOutcome: "succeeded" });
            const postId = await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Hello world");
            vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
            await ports.livePosts.set("daily-thread", postId);
            await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt: new Date("2026-04-21T12:30:05Z") });

            await expect(
                world.deliverTwice("/internal/triggers/app-upgrade", { type: "AppUpgrade" }),
            ).resolves.toStrictEqual([200, 200]);
            await expect(refreshJobs()).resolves.toStrictEqual(["daily-thread 2026-04-21T12:30:05.000Z"]);
            await expect(redis.get("AppliedThreadConfigs")).resolves.toBeUndefined();
            await expect(redis.hKeys("AppliedThreadConfigsByName")).resolves.toStrictEqual(["daily-thread"]);
        },
    );

    devvitIt("replace a removed live post at the next refresh check", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeDate("2026-04-21T10:00:00Z");
        const logSpy = silenceConsole("log");
        const world = createHarnessWorld(VALID_CONFIG_PAGE);
        await redis.set("LastRevision", "rev-1");
        await storeThreadConfigs([wcConfig("wc-01")], configReadPorts(world.context));
        const ports = rotationPorts(world.context);
        await recordAllApplied(ports);
        const postId = await submitPostAt("2026-04-21T05:00:00Z", "TEST worst case wc-01", "Edited body of wc-01");
        vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
        await ports.livePosts.set("wc-01", postId);
        await world.deliverTwice("/internal/triggers/post-delete", { type: "PostDelete", postId });
        vi.setSystemTime(new Date("2026-04-21T10:43:00Z"));

        await world.deliverTwice("/internal/jobs/refresh-check", { name: "RefreshCheck" });

        await expect(refreshJobs()).resolves.toStrictEqual(["wc-01 2026-04-21T10:43:01.000Z"]);
        expect(logSpy).toHaveBeenCalledWith("Requested a refresh of thread config wc-01: it has no live post.");
    });
});
