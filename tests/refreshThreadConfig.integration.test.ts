import { reddit, redis } from "@devvit/web/server";
import { T3 as asPostId } from "@devvit/web/shared";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { refreshThreadConfig, requestEveryThreadRefresh } from "../src/rotation/index.js";
import { HARNESS_CONTEXT, listRefreshJobs, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

const ACTIVE_CONFIG: ThreadConfig = {
    name: "active-thread",
    enabled: true,
    title: "Active thread",
    frequency: "daily",
    postTime: "12:30",
    maxComments: 200,
    body: "Active body",
    sticky: true,
};

async function refreshJobs(): Promise<string[]> {
    return (await listRefreshJobs()).map(
        (job: Readonly<{ runAt: Date; data: Readonly<Record<string, unknown>> | undefined }>): string =>
            `${String(job.data?.["configName"])} ${job.runAt.toISOString()}`,
    );
}

/** Fakes the clock, silences logging, stores `configs` and submits the active thread config's post at 05:00. */
async function submitActivePost(configs: readonly ThreadConfig[], body: string): Promise<string> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    await storeThreadConfigs(configs, configReadPorts(HARNESS_CONTEXT));
    const activePostId = await submitPostAt("2026-04-21T05:00:00Z", "Active thread", body);
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
    await redis.hSet("StickyPostStore", { "active-thread": activePostId });
    return activePostId;
}

describe(refreshThreadConfig, (): void => {
    devvitIt(
        "edits the body of a live post instead of replacing it, then schedules its rotation",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const activePostId = await submitActivePost([{ ...ACTIVE_CONFIG, body: "Updated body" }], "Old body");

            await refreshThreadConfig("active-thread", rotationPorts(HARNESS_CONTEXT));

            await expect(reddit.getPostById(asPostId(activePostId))).resolves.toHaveProperty("body", "Updated body");
            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
            await expect(refreshJobs()).resolves.toStrictEqual(["active-thread 2026-04-21T12:30:05.000Z"]);
        },
    );

    devvitIt(
        "forgets a thread config no longer in force, with its live post and comment cap",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const activePostId = await submitActivePost([ACTIVE_CONFIG], "Active body");
            await redis.hSet("StickyPostStore", { "stale-thread": "t3_stale" });
            await redis.set("CommentCap:t3_stale", "150");

            await refreshThreadConfig("stale-thread", rotationPorts(HARNESS_CONTEXT));

            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
            await expect(redis.get("CommentCap:t3_stale")).resolves.toBeUndefined();
        },
    );
});

describe(requestEveryThreadRefresh, (): void => {
    devvitIt(
        "requests a refresh of each enabled thread config and forgets disabled ones",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const disabledConfig: ThreadConfig = { ...ACTIVE_CONFIG, name: "disabled-thread", enabled: false };
            const activePostId = await submitActivePost([ACTIVE_CONFIG, disabledConfig], "Active body");
            await redis.hSet("StickyPostStore", { "disabled-thread": "t3_disabled" });

            await requestEveryThreadRefresh(
                rotationPorts(HARNESS_CONTEXT),
                "thread configs stored since the last refresh",
            );

            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
            await expect(refreshJobs()).resolves.toStrictEqual(["active-thread 2026-04-21T10:00:01.000Z"]);
        },
    );
});
