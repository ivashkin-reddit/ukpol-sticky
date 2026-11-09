import { redis, scheduler } from "@devvit/web/server";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { REFRESH_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { scheduleEveryThreadRefresh } from "../src/rotation/index.js";
import { HARNESS_CONTEXT, listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";

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
const WEEKLY_CONFIG: ThreadConfig = {
    name: "weekly-thread",
    enabled: true,
    title: "Weekly thread",
    frequency: "wednesdays",
    postTime: "08:00",
    maxComments: 200,
    body: "Weekly body",
};
const CAP_CONFIG: ThreadConfig = {
    name: "cap-thread",
    enabled: true,
    title: "Cap thread",
    maxComments: 200,
    body: "Cap body",
};

/** Each pending refresh as "<thread config> <time>", sorted: jobs scheduled in parallel list in any order. */
async function refreshJobs(): Promise<string[]> {
    const jobs = (await listRefreshJobs()).map(
        (job: Readonly<{ runAt: Date; data: Readonly<Record<string, unknown>> | undefined }>): string =>
            `${String(job.data?.["configName"])} ${job.runAt.toISOString()}`,
    );
    return jobs.sort((first: string, second: string): number => first.localeCompare(second));
}

async function jobNames(): Promise<string[]> {
    return (await scheduler.listJobs()).map((job: Readonly<{ name: string }>): string => job.name);
}

/** Stores `configs`, each recorded as applied, as they are once their refreshes have run. */
async function storeAppliedThreadConfigs(configs: readonly ThreadConfig[]): Promise<void> {
    await storeThreadConfigs(configs, configReadPorts(HARNESS_CONTEXT));
    const ports = rotationPorts(HARNESS_CONTEXT);
    await Promise.all(
        (await ports.threadConfigs()).map(async (config: ThreadConfig): Promise<void> => {
            await ports.appliedThreadConfigs.record(config);
        }),
    );
}

describe(scheduleEveryThreadRefresh, (): void => {
    devvitIt(
        "schedules each thread config five seconds after its rotation time and cancels the job from before the upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            await storeAppliedThreadConfigs([DAILY_CONFIG, WEEKLY_CONFIG, CAP_CONFIG]);
            await redis.hSet("StickyPostStore", {
                "daily-thread": await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Daily body"),
                "weekly-thread": await submitPostAt("2026-04-15T09:00:00Z", "Weekly thread", "Weekly body"),
                "cap-thread": await submitPostAt("2026-04-21T07:00:00Z", "Cap thread", "Cap body"),
            });
            vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
            await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt: new Date("2026-04-21T12:30:05Z") });
            await scheduler.runJob({ name: "keep-me", runAt: new Date("2026-04-22T00:00:00Z") });

            await scheduleEveryThreadRefresh(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobs()).resolves.toStrictEqual([
                "daily-thread 2026-04-21T12:30:05.000Z",
                "weekly-thread 2026-04-22T08:00:05.000Z",
            ]);
            await expect(jobNames()).resolves.toContain("keep-me");
            expect(logSpy).toHaveBeenCalledWith(
                "Thread config cap-thread has no schedule, so only its comment cap rotates it.",
            );
        },
    );

    devvitIt("schedules an overdue rotation five seconds from now", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        await storeAppliedThreadConfigs([{ ...DAILY_CONFIG, postTime: "04:00" }]);
        await redis.hSet("StickyPostStore", {
            "daily-thread": await submitPostAt("2026-04-19T08:00:00Z", "Daily thread", "Daily body"),
        });
        vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

        await scheduleEveryThreadRefresh(rotationPorts(HARNESS_CONTEXT));

        await expect(refreshJobs()).resolves.toStrictEqual(["daily-thread 2026-04-21T10:00:05.000Z"]);
    });
});
