import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { fullPost, LOOSE_CONFIG, newPost, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import type { ManagedPost } from "./ports.js";
import { refreshAllThreads } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe("refreshAllThreads and the applied thread configs", (): void => {
    it(
        "records the thread configs it refreshed with as applied, before it schedules the next refresh",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const configs = [{ ...STICKY_CONFIG, body: "New body" }];
            const fakes = createFakeRotationPorts(configs);
            fakes.livePosts.get.mockResolvedValue("t3_live");
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_live" });
            fakes.posts.get.mockResolvedValue(fullPost("t3_live", 10).post);

            await refreshAllThreads(fakes.ports);

            expect(fakes.appliedThreadConfigs.record).toHaveBeenCalledExactlyOnceWith(configs);
            expect(fakes.appliedThreadConfigs.record).toHaveBeenCalledBefore(fakes.refreshJobs.cancelAll);
        },
    );

    it(
        "records them even when a thread config fails, so it is retried after the retry delay, not at once",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            silenceConsole("error");
            const fakes = createFakeRotationPorts([STICKY_CONFIG, LOOSE_CONFIG]);
            // A config page save stored these thread configs since the last refresh.
            await fakes.ports.appliedThreadConfigs.record([]);
            fakes.livePosts.get.mockImplementation(
                async (configName: string): Promise<string | undefined> =>
                    await Promise.resolve(configName === "sticky-thread" ? "t3_gone" : undefined),
            );
            fakes.livePosts.all.mockResolvedValue({ "sticky-thread": "t3_gone", "loose-thread": "t3_loose" });
            const loosePost = newPost("t3_loose");
            fakes.posts.get.mockImplementation(
                async (postId: string): Promise<ManagedPost> =>
                    await (postId === "t3_gone"
                        ? Promise.reject(new Error("post t3_gone not found"))
                        : Promise.resolve(loosePost.post)),
            );
            fakes.posts.publish.mockResolvedValue(loosePost.post);

            await expect(refreshAllThreads(fakes.ports)).rejects.toThrow(
                new Error("Could not refresh thread config sticky-thread: post t3_gone not found"),
            );
            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:15:05.000Z"));
        },
    );

    it(
        "records that no thread config is in force, so rescheduling does not refresh again at once",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            silenceConsole("log");
            const fakes = createFakeRotationPorts([]);
            // The moderators removed the last thread config since the last refresh.
            await fakes.ports.appliedThreadConfigs.record([STICKY_CONFIG]);

            await refreshAllThreads(fakes.ports);

            expect(fakes.appliedThreadConfigs.record).toHaveBeenLastCalledWith([]);
            expect(fakes.refreshJobs.cancelAll).toHaveBeenCalledExactlyOnceWith();
            expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
        },
    );

    it(
        "leaves a refresh due at once when thread configs were stored while it ran",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const fakes = createFakeRotationPorts([LOOSE_CONFIG]);
            fakes.livePosts.get.mockResolvedValue("t3_loose");
            fakes.livePosts.all.mockResolvedValue({ "loose-thread": "t3_loose" });
            fakes.posts.get.mockResolvedValue({ ...fullPost("t3_loose", 5).post, body: "Loose body" });
            // A config page save stored a new body after this refresh read the thread configs.
            fakes.threadConfigs
                .mockResolvedValueOnce([LOOSE_CONFIG])
                .mockResolvedValue([{ ...LOOSE_CONFIG, body: "Edited body" }]);

            await refreshAllThreads(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:00:05.000Z"));
        },
    );
});
