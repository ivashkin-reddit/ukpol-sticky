import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { unlabelled } from "../../tests/support/fakeHighlights.js";
import { findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { DAILY_CONFIG, dailyPost, fullPost, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import type { ThreadStatus } from "./threadStatus.js";
import { getThreadStatuses } from "./threadStatus.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

function slotShown(status: ThreadStatus): number | string | undefined {
    return status.kind === "readable" && status.livePost.kind === "readable" ? status.livePost.slot : "none";
}

describe("getThreadStatuses' slots", (): void => {
    it("reads the highlights once, for every thread config's slot", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        freezeTime("2026-04-21T10:00:00Z");
        const configs = [DAILY_CONFIG, STICKY_CONFIG];
        const livePostIds = { "daily-thread": "t3_daily", "sticky-thread": "t3_sticky" };
        const fakes = createFakeRotationPorts(
            configs,
            { all: async (): Promise<Readonly<Record<string, string>>> => await Promise.resolve(livePostIds) },
            unlabelled("t3_sticky"),
        );
        fakes.posts.get.mockImplementation(
            findingPostsById([dailyPost("t3_daily").post, fullPost("t3_sticky", 3).post]),
        );

        const statuses = await getThreadStatuses(configs, fakes.ports);

        expect(statuses.threads.map(slotShown)).toStrictEqual([1, undefined]);
        expect(fakes.highlights.list).toHaveBeenCalledExactlyOnceWith();
    });
});
