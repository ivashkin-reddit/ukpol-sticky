import { redis } from "@devvit/web/server";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import { getRefreshStatus, refreshThreadConfig } from "../src/rotation/index.js";
import { HARNESS_CONTEXT, submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

describe("the refresh status", (): void => {
    devvitIt("records a successful refresh and when the next is due", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        await storeThreadConfigs(
            [
                {
                    name: "daily-thread",
                    enabled: true,
                    title: "Daily thread",
                    frequency: "daily",
                    postTime: "12:30",
                    maxComments: 200,
                    body: "Daily body",
                },
            ],
            configReadPorts(HARNESS_CONTEXT),
        );
        // The harness cannot distinguish or sticky posts, so the thread already has an up-to-date live post.
        const livePostId = await submitPostAt("2026-04-21T05:00:00Z", "Daily thread", "Daily body");
        await redis.hSet("StickyPostStore", { "daily-thread": livePostId });
        vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
        const ports = rotationPorts(HARNESS_CONTEXT);

        await refreshThreadConfig("daily-thread", ports);

        await expect(getRefreshStatus(ports.refreshStatus, ["daily-thread"])).resolves.toStrictEqual({
            "daily-thread": {
                lastRefresh: { at: new Date("2026-04-21T10:00:00Z"), outcome: "succeeded" },
                lastSuccessAt: new Date("2026-04-21T10:00:00Z"),
                nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
            },
        });
    });
});
