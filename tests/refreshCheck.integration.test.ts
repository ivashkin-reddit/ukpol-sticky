import { scheduler } from "@devvit/scheduler";
import type { ScheduledCronJob } from "@devvit/scheduler";
import { describe, expect, vi } from "vitest";
import { rotationPorts } from "../src/composition.js";
import { REFRESH_CHECK_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { ensureRefreshPending, refreshAllThreads, requestRefresh, startRefreshCheck } from "../src/rotation/index.js";
import { HARNESS_CONTEXT, listRefreshJobs } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

function isRefreshCheck(job: Readonly<{ name: string }>): job is ScheduledCronJob {
    return "cron" in job && job.name === REFRESH_CHECK_JOB_NAME;
}

async function refreshCheckCrons(): Promise<string[]> {
    return (await scheduler.listJobs())
        .filter(isRefreshCheck)
        .map(({ cron }: Readonly<{ cron: string }>): string => cron);
}

async function refreshJobRunTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map(({ runAt }: Readonly<{ runAt: Date }>): string => runAt.toISOString());
}

async function refreshJobIds(): Promise<string[]> {
    return (await listRefreshJobs()).map(({ id }: Readonly<{ id: string }>): string => id);
}

describe("the refresh check", (): void => {
    devvitIt("is scheduled once, hourly, however often it is started", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { refreshJobs } = rotationPorts(HARNESS_CONTEXT);
        await startRefreshCheck(refreshJobs);
        await startRefreshCheck(refreshJobs);

        await expect(refreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
    });

    devvitIt("requests a refresh when none is pending", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:43:00Z");
        silenceConsole("log");
        const ports = rotationPorts(HARNESS_CONTEXT);
        await startRefreshCheck(ports.refreshJobs);

        await ensureRefreshPending(ports);

        await expect(listRefreshJobs()).resolves.toHaveLength(1);
    });

    devvitIt("leaves a pending refresh alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:43:00Z");
        const ports = rotationPorts(HARNESS_CONTEXT);
        await requestRefresh(ports);
        const pendingIds = await refreshJobIds();

        await ensureRefreshPending(ports);

        await expect(refreshJobIds()).resolves.toStrictEqual(pendingIds);
    });

    devvitIt(
        "replaces a refresh that was due an hour ago and never ran with exactly one new refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:43:00Z");
            silenceConsole("error");
            const ports = rotationPorts(HARNESS_CONTEXT);
            await requestRefresh(ports);
            vi.setSystemTime(new Date("2026-04-21T11:43:00Z"));

            await ensureRefreshPending(ports);

            await expect(refreshJobRunTimes()).resolves.toStrictEqual(["2026-04-21T11:43:01.000Z"]);
        },
    );

    devvitIt("is started again by a refresh that finds it gone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        silenceConsole("error");
        const ports = rotationPorts(HARNESS_CONTEXT);

        await refreshAllThreads(ports);

        await expect(refreshCheckCrons()).resolves.toStrictEqual(["43 * * * *"]);
    });
});
