import { scheduler } from "@devvit/scheduler";
import type { ScheduledCronJob } from "@devvit/scheduler";
import { describe, expect } from "vitest";
import { rotationPorts } from "../src/composition.js";
import { REFRESH_CHECK_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { ensureRefreshPending, requestRefresh, startRefreshCheck } from "../src/rotation/index.js";
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
        await requestRefresh(ports.refreshJobs);
        const pendingIds = await refreshJobIds();

        await ensureRefreshPending(ports);

        await expect(refreshJobIds()).resolves.toStrictEqual(pendingIds);
    });
});
