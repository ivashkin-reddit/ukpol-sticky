import { redis } from "@devvit/redis";
import { scheduler } from "@devvit/scheduler";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { REFRESH_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { scheduleNextRefresh } from "../src/rotation/index.js";
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
    sticky: true,
};
const WEEKLY_CONFIG: ThreadConfig = {
    name: "weekly-thread",
    enabled: true,
    title: "Weekly thread",
    frequency: "wednesdays",
    postTime: "08:00",
    maxComments: 200,
    body: "Weekly body",
    sticky: true,
};
const CAP_CONFIG: ThreadConfig = {
    name: "cap-thread",
    enabled: true,
    title: "Cap thread",
    maxComments: 200,
    body: "Cap body",
    sticky: true,
};

async function refreshJobTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map((job: Readonly<{ runAt: Date }>): string => job.runAt.toISOString());
}

async function jobNames(): Promise<string[]> {
    return (await scheduler.listJobs()).map((job: Readonly<{ name: string }>): string => job.name);
}

/** Stores `configs` as the thread configs in force, recorded as applied, as they are once a refresh has run. */
async function storeAppliedThreadConfigs(configs: readonly ThreadConfig[]): Promise<void> {
    await storeThreadConfigs(configs, configReadPorts(HARNESS_CONTEXT));
    const ports = rotationPorts(HARNESS_CONTEXT);
    await ports.appliedThreadConfigs.record(await ports.threadConfigs());
}

describe(scheduleNextRefresh, (): void => {
    devvitIt(
        "replaces pending refresh jobs with one five seconds after the earliest rotation time",
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
            await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt: new Date("2026-04-21T09:30:00Z") });
            await scheduler.runJob({ name: "keep-me", runAt: new Date("2026-04-22T00:00:00Z") });

            await scheduleNextRefresh(rotationPorts(HARNESS_CONTEXT));

            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
            await expect(jobNames()).resolves.toContain("keep-me");
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Next refresh scheduled for 2026-04-21T12:30:05.000Z: it rotates thread config daily-thread.",
            );
        },
    );

    devvitIt("removes pending refresh jobs when no live post has a schedule", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        freezeTime("2026-04-21T10:00:00Z");
        const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        await storeAppliedThreadConfigs([CAP_CONFIG]);
        await redis.hSet("StickyPostStore", {
            "cap-thread": await submitPostAt("2026-04-21T07:00:00Z", "Cap thread", "Cap body"),
        });
        await scheduler.runJob({ name: REFRESH_JOB_NAME, runAt: new Date("2026-04-21T14:00:00Z") });
        await scheduler.runJob({ name: "keep-me", runAt: new Date("2026-04-22T00:00:00Z") });

        await scheduleNextRefresh(rotationPorts(HARNESS_CONTEXT));

        await expect(refreshJobTimes()).resolves.toStrictEqual([]);
        await expect(jobNames()).resolves.toStrictEqual(["keep-me"]);
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("No live post has a schedule, so no refresh is scheduled.");
    });

    devvitIt("schedules an overdue refresh five seconds from now", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        await storeAppliedThreadConfigs([{ ...DAILY_CONFIG, postTime: "04:00" }]);
        await redis.hSet("StickyPostStore", {
            "daily-thread": await submitPostAt("2026-04-19T08:00:00Z", "Daily thread", "Daily body"),
        });
        vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

        await scheduleNextRefresh(rotationPorts(HARNESS_CONTEXT));

        await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T10:00:05.000Z"]);
    });
});
