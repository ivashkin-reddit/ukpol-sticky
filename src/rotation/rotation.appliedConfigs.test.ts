import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { fullPost, LOOSE_CONFIG, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { refreshThreadConfig } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe("refreshThreadConfig and the applied thread config", (): void => {
    it(
        "records the version it refreshed with as applied, before it schedules the next refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const config = { ...STICKY_CONFIG, body: "New body" };
            const fakes = createFakeRotationPorts([config]);
            fakes.livePosts.get.mockResolvedValue("t3_live");
            fakes.posts.get.mockResolvedValue(fullPost("t3_live", 10).post);

            await refreshThreadConfig("sticky-thread", fakes.ports);

            expect(fakes.appliedThreadConfigs.record).toHaveBeenCalledExactlyOnceWith(config);
            expect(fakes.appliedThreadConfigs.record).toHaveBeenCalledBefore(fakes.refreshJobs.cancelFor);
        },
    );

    it(
        "records it even when the refresh fails, so it is retried after the retry delay, not at once",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            // A config page save stored this thread config since its last refresh.
            await fakes.ports.appliedThreadConfigs.forget(["sticky-thread"]);
            fakes.livePosts.get.mockResolvedValue("t3_gone");
            const postGone = new Error("post t3_gone not found");
            fakes.posts.get.mockRejectedValue(postGone);

            await expect(refreshThreadConfig("sticky-thread", fakes.ports)).rejects.toBe(postGone);
            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "sticky-thread",
                new Date("2026-04-21T10:15:05.000Z"),
            );
        },
    );

    it(
        "leaves a refresh due at once when the thread config was stored again while it ran",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            fakes.livePosts.get.mockResolvedValue("t3_loose");
            fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });
            // A config page save stored a new body after this refresh read the thread configs.
            fakes.threadConfigs
                .mockResolvedValueOnce([LOOSE_CONFIG])
                .mockResolvedValue([{ ...LOOSE_CONFIG, body: "Edited body" }]);

            await refreshThreadConfig("loose-thread", fakes.ports);

            expect(fakes.refreshJobs.replaceFor).toHaveBeenCalledExactlyOnceWith(
                "loose-thread",
                new Date("2026-04-21T10:00:05.000Z"),
            );
        },
    );
});
