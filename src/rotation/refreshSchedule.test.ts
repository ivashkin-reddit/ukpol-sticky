import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { createFakePost } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { RefreshStatus } from "./ports.js";
import { getRefreshStatus, requestRefresh, scheduleNextRefresh } from "./refreshSchedule.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(scheduleNextRefresh, (): void => {
    it(
        "fails without cancelling pending refreshes when the thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts();
            const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");
            fakes.threadConfigs.mockRejectedValue(unreadable);

            await expect(scheduleNextRefresh(fakes.ports)).rejects.toThrow(unreadable);
            expect(fakes.refreshJobs.cancelAll).not.toHaveBeenCalled();
            expect(fakes.refreshJobs.replaceWith).not.toHaveBeenCalled();
        },
    );

    it(
        "schedules a refresh at once while the thread configs in force are not the ones the last refresh applied",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            silenceConsole("log");
            const daily: ThreadConfig = {
                name: "daily-thread",
                enabled: true,
                title: "Daily",
                frequency: "daily",
                postTime: "12:30",
                maxComments: 100,
                body: "Body",
            };
            const fakes = createFakeRotationPorts([{ ...daily, body: "Edited body" }]);
            // The last refresh applied the old body; its live post is not due until 12:30.
            await fakes.ports.appliedThreadConfigs.record([daily]);
            fakes.livePosts.all.mockResolvedValue({ "daily-thread": "t3_daily" });
            fakes.posts.get.mockResolvedValue(
                createFakePost({
                    body: "Body",
                    createdAt: new Date("2026-04-21T05:00:00Z"),
                    id: "t3_daily",
                    numberOfComments: 0,
                    stickied: true,
                }).post,
            );

            await scheduleNextRefresh(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:00:05.000Z"));
        },
    );
});

describe(requestRefresh, (): void => {
    it(
        "replaces pending refreshes with one a second from now, and records it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = createFakeRotationPorts();

            await requestRefresh(fakes.ports);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:00:01.000Z"));
            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(
                new Date("2026-04-21T10:00:01.000Z"),
            );
        },
    );
});

describe("scheduleNextRefresh and the refresh status", (): void => {
    it("records when the next refresh is due", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        const fakes = createFakeRotationPorts([
            {
                name: "daily-thread",
                enabled: true,
                title: "Daily",
                frequency: "daily",
                postTime: "12:30",
                maxComments: 100,
                body: "Body",
            },
        ]);
        fakes.livePosts.all.mockResolvedValue({ "daily-thread": "t3_daily" });
        fakes.posts.get.mockResolvedValue(
            createFakePost({
                body: "Body",
                createdAt: new Date("2026-04-21T05:00:00Z"),
                id: "t3_daily",
                numberOfComments: 0,
                stickied: true,
            }).post,
        );

        await scheduleNextRefresh(fakes.ports);

        expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(
            new Date("2026-04-21T12:30:05.000Z"),
        );
    });

    it(
        "records that no refresh is scheduled when no live post has a schedule",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const fakes = createFakeRotationPorts();

            await scheduleNextRefresh(fakes.ports);

            expect(fakes.refreshStatus.recordNextRefresh).toHaveBeenCalledExactlyOnceWith(undefined);
        },
    );
});

describe("scheduleNextRefresh after thread configs failed", (): void => {
    it(
        "leaves their rotation times out and retries them fifteen minutes on, if that is sooner",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T13:00:00Z");
            silenceConsole("log");
            // The live post was due at 12:30, so without the retry the next refresh would be due now.
            const fakes = createFakeRotationPorts([
                {
                    name: "daily-thread",
                    enabled: true,
                    title: "Daily",
                    frequency: "daily",
                    postTime: "12:30",
                    maxComments: 100,
                    body: "Body",
                },
            ]);
            fakes.livePosts.all.mockResolvedValue({ "daily-thread": "t3_daily" });

            await scheduleNextRefresh(fakes.ports, ["daily-thread"]);

            expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T13:15:05.000Z"));
        },
    );
});

describe("scheduleNextRefresh for a thread config without a live post", (): void => {
    it("schedules a refresh straight away to publish one", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        silenceConsole("log");
        // Saved while a refresh ran, say, so that refresh published nothing for it.
        const fakes = createFakeRotationPorts([
            { name: "new-thread", enabled: true, title: "New", maxComments: 100, body: "Body" },
        ]);

        await scheduleNextRefresh(fakes.ports);

        expect(fakes.refreshJobs.replaceWith).toHaveBeenCalledExactlyOnceWith(new Date("2026-04-21T10:00:05.000Z"));
    });
});

describe(getRefreshStatus, (): void => {
    it("reads the recorded refresh status", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        const status: RefreshStatus = {
            lastRefresh: { at: new Date("2026-04-21T12:30:05Z"), outcome: "failed", failure: "Reddit is down" },
            lastSuccessAt: new Date("2026-04-20T12:30:05Z"),
            nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
        };
        fakes.refreshStatus.read.mockResolvedValue(status);

        await expect(getRefreshStatus(fakes.ports.refreshStatus)).resolves.toBe(status);
    });
});
