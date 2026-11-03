import { asT3ID } from "@devvit/public-api/types/tid.js";
import { reddit } from "@devvit/reddit";
import { redis } from "@devvit/redis";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { refreshAllThreads } from "../src/rotation/index.js";
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

async function refreshJobTimes(): Promise<string[]> {
    return (await listRefreshJobs()).map((job: Readonly<{ runAt: Date }>): string => job.runAt.toISOString());
}

/** Fakes the clock, silences logging, stores `configs` and submits the active thread config's post at 05:00. */
async function submitActivePost(configs: readonly ThreadConfig[], body: string): Promise<string> {
    freezeTime("2026-04-21T10:00:00Z");
    vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
    await storeThreadConfigs(configs, configReadPorts(HARNESS_CONTEXT));
    const activePostId = await submitPostAt("2026-04-21T05:00:00Z", "Active thread", body);
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
    return activePostId;
}

describe(refreshAllThreads, (): void => {
    devvitIt(
        "forgets live posts whose thread config is gone and keeps the others",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const activePostId = await submitActivePost([ACTIVE_CONFIG], "Active body");
            await redis.hSet("StickyPostStore", { "active-thread": activePostId, "stale-thread": "t3_stale" });
            await redis.set("CommentCap:t3_stale", "150");

            await refreshAllThreads(rotationPorts(HARNESS_CONTEXT));

            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
            await expect(redis.get("CommentCap:t3_stale")).resolves.toBeUndefined();
            await expect(redis.get(`CommentCap:${activePostId}`)).resolves.toBe("200");
            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
        },
    );

    devvitIt("edits the body of a live post instead of replacing it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const activePostId = await submitActivePost([{ ...ACTIVE_CONFIG, body: "Updated body" }], "Old body");
        await redis.hSet("StickyPostStore", { "active-thread": activePostId });

        await refreshAllThreads(rotationPorts(HARNESS_CONTEXT));

        await expect(reddit.getPostById(asT3ID(activePostId))).resolves.toHaveProperty("body", "Updated body");
        await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
        await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
    });

    devvitIt(
        "forgets disabled configs' posts and leaves them out of scheduling",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const disabledConfig: ThreadConfig = {
                ...ACTIVE_CONFIG,
                name: "disabled-thread",
                enabled: false,
                postTime: "12:00",
                title: "Disabled thread",
                body: "Disabled body",
            };
            const activePostId = await submitActivePost([ACTIVE_CONFIG, disabledConfig], "Active body");
            const disabledPostId = await submitPostAt("2026-04-21T05:00:00Z", "Disabled thread", "Disabled body");
            vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
            await redis.hSet("StickyPostStore", { "active-thread": activePostId, "disabled-thread": disabledPostId });
            await redis.set(`CommentCap:${disabledPostId}`, "150");

            await refreshAllThreads(rotationPorts(HARNESS_CONTEXT));

            await expect(redis.hGetAll("StickyPostStore")).resolves.toStrictEqual({ "active-thread": activePostId });
            await expect(redis.get(`CommentCap:${disabledPostId}`)).resolves.toBeUndefined();
            await expect(refreshJobTimes()).resolves.toStrictEqual(["2026-04-21T12:30:05.000Z"]);
        },
    );
});
