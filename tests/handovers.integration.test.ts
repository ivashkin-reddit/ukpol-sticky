import { describe, expect } from "vitest";
import { rotationPorts } from "../src/composition.js";
import { HARNESS_CONTEXT } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

describe("unfinished handovers on Devvit's Redis", (): void => {
    devvitIt(
        "are read back as saved, and name their thread configs among those with live state",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { livePosts } = rotationPorts(HARNESS_CONTEXT);
            await livePosts.set("daily-thread", "t3_new");
            await livePosts.saveHandover("daily-thread", { newPostId: "t3_new", oldPostId: "t3_old" });
            await livePosts.saveHandover("weekly-thread", { newPostId: "t3_week" });

            await expect(livePosts.handovers()).resolves.toStrictEqual({
                "daily-thread": { newPostId: "t3_new", oldPostId: "t3_old" },
                "weekly-thread": { newPostId: "t3_week" },
            });
            await expect(livePosts.configNames()).resolves.toStrictEqual(["daily-thread", "weekly-thread"]);
        },
    );

    devvitIt("are deleted once finished, or with their thread config", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { livePosts } = rotationPorts(HARNESS_CONTEXT);
        await livePosts.saveHandover("daily-thread", { newPostId: "t3_new" });
        await livePosts.saveHandover("weekly-thread", { newPostId: "t3_week" });

        await livePosts.forgetHandover("daily-thread");
        await livePosts.forget(["weekly-thread"], []);

        await expect(livePosts.handovers()).resolves.toStrictEqual({});
    });
});
