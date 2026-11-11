import { describe, expect, it } from "vitest";
import { freezeTime } from "../../tests/support/fakeClock.js";
import { findingPostsById } from "../../tests/support/fakePosts.js";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import {
    COMMENT_CAP,
    DAILY_CONFIG,
    dailyPost,
    DISABLED_CONFIG,
    fullPost,
    LOOSE_CONFIG,
    STICKY_CONFIG,
} from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { writesMade } from "../../tests/support/writes.js";
import type { ThreadConfig } from "../configuration/index.js";
import type { RefreshStatus } from "./ports.js";
import { findLivePostLink, getThreadStatuses } from "./threadStatus.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NO_REFRESH_STATUS: RefreshStatus = {
    lastRefresh: undefined,
    lastSuccessAt: undefined,
    nextRefreshAt: undefined,
    nextRefreshReason: undefined,
};

/** Fakes over `configs`, whose live posts are `livePostIds`; the daily and sticky posts can be read. */
function statusWorld(
    configs: readonly ThreadConfig[],
    livePostIds: Readonly<Record<string, string>>,
): FakeRotationPorts {
    const fakes = createFakeRotationPorts(configs, {
        all: async (): Promise<Readonly<Record<string, string>>> => await Promise.resolve(livePostIds),
    });
    fakes.posts.get.mockImplementation(findingPostsById([dailyPost("t3_daily").post, fullPost("t3_sticky", 3).post]));
    fakes.livePosts.getCommentCap.mockResolvedValue(COMMENT_CAP);
    return fakes;
}

describe(getThreadStatuses, (): void => {
    it(
        "reads a thread config's live post, comments against its cap, refresh status and handover, and only reads",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = statusWorld([DAILY_CONFIG], { "daily-thread": "t3_daily" });
            const refreshStatus: RefreshStatus = {
                lastRefresh: { at: new Date("2026-04-21T05:00:00Z"), outcome: "succeeded" },
                lastSuccessAt: new Date("2026-04-21T05:00:00Z"),
                nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
                nextRefreshReason: "to rotate it",
            };
            fakes.refreshStatus.read.mockResolvedValue({ "daily-thread": refreshStatus });
            fakes.livePosts.handovers.mockResolvedValue({ "daily-thread": { newPostId: "t3_daily" } });

            await expect(getThreadStatuses([DAILY_CONFIG], fakes.ports)).resolves.toStrictEqual({
                threads: [
                    {
                        kind: "readable",
                        configName: "daily-thread",
                        hasSchedule: true,
                        livePost: {
                            kind: "readable",
                            id: "t3_daily",
                            title: "Post t3_daily",
                            stickied: false,
                            createdAt: new Date("2026-04-21T05:00:00Z"),
                            comments: 0,
                            commentCap: COMMENT_CAP,
                        },
                        refreshStatus,
                        handover: { newPostId: "t3_daily" },
                        attention: [{ kind: "check", finding: { kind: "unfinished handover" } }],
                    },
                ],
                disabled: [],
                hourlyCheckScheduled: true,
            });
            expect(writesMade(fakes.writes)).toStrictEqual([]);
        },
    );

    it(
        "puts those needing attention first, the rest in refresh order, and names the disabled ones",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const configs = [LOOSE_CONFIG, DISABLED_CONFIG, DAILY_CONFIG, STICKY_CONFIG];
            const fakes = statusWorld(configs, { "daily-thread": "t3_daily", "sticky-thread": "t3_sticky" });

            const statuses = await getThreadStatuses(configs, fakes.ports);

            // The loose thread has no live post, and no refresh of it is due soon.
            expect(statuses.threads.map((status): string => status.configName)).toStrictEqual([
                "loose-thread",
                "sticky-thread",
                "daily-thread",
            ]);
            expect(statuses.disabled).toStrictEqual(["disabled-thread"]);
        },
    );

    it(
        "shows a live post that cannot be read, and that its thread config needs attention",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const errorSpy = silenceConsole("error");
            const fakes = statusWorld([DAILY_CONFIG], { "daily-thread": "t3_gone" });

            const [status] = (await getThreadStatuses([DAILY_CONFIG], fakes.ports)).threads;

            expect(status?.kind === "readable" ? status.livePost : undefined).toStrictEqual({
                kind: "unreadable",
                postId: "t3_gone",
            });
            expect(status?.kind === "readable" ? status.attention : undefined).toStrictEqual([
                { kind: "postUnreadable" },
            ]);
            expect(errorSpy.mock.calls).toStrictEqual([
                [
                    "The status could not read live post t3_gone of thread config daily-thread:",
                    new Error("no post t3_gone"),
                ],
            ]);
        },
    );

    it(
        "shows a thread config whose last refresh failed as needing attention",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = statusWorld([DAILY_CONFIG], { "daily-thread": "t3_daily" });
            fakes.refreshStatus.read.mockResolvedValue({
                "daily-thread": {
                    ...NO_REFRESH_STATUS,
                    lastRefresh: { at: new Date("2026-04-21T09:50:00Z"), outcome: "failed", failure: "Reddit is down" },
                    nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
                },
            });

            const [status] = (await getThreadStatuses([DAILY_CONFIG], fakes.ports)).threads;

            expect(status?.kind === "readable" ? status.attention : undefined).toStrictEqual([{ kind: "failed" }]);
        },
    );

    it(
        "reads each thread config's own pending refreshes when looking for a stuck one",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            const fakes = statusWorld([DAILY_CONFIG, STICKY_CONFIG], {
                "daily-thread": "t3_daily",
                "sticky-thread": "t3_sticky",
            });
            fakes.refreshJobs.pending.mockResolvedValue([
                { configName: "sticky-thread", runAt: new Date("2026-04-21T09:00:05Z") },
                { configName: "daily-thread", runAt: new Date("2026-04-21T12:30:05Z") },
            ]);

            const statuses = await getThreadStatuses([DAILY_CONFIG, STICKY_CONFIG], fakes.ports);

            expect(
                statuses.threads.map((status): readonly [string, number] => [
                    status.configName,
                    status.kind === "readable" ? status.attention.length : -1,
                ]),
            ).toStrictEqual([
                ["sticky-thread", 1],
                ["daily-thread", 0],
            ]);
        },
    );

    it(
        "shows a thread config whose status cannot be read as such, without hiding the others",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const errorSpy = silenceConsole("error");
            const failure = new Error("Redis is down");
            const fakes = statusWorld([DAILY_CONFIG, STICKY_CONFIG], {
                "daily-thread": "t3_daily",
                "sticky-thread": "t3_sticky",
            });
            fakes.appliedThreadConfigs.matches.mockImplementation(
                async (config: ThreadConfig): Promise<boolean> =>
                    await (config.name === "daily-thread" ? Promise.reject(failure) : Promise.resolve(true)),
            );

            const statuses = await getThreadStatuses([DAILY_CONFIG, STICKY_CONFIG], fakes.ports);

            expect(statuses.threads.map((status): string => `${status.configName}:${status.kind}`)).toStrictEqual([
                "daily-thread:unreadable",
                "sticky-thread:readable",
            ]);
            expect(errorSpy.mock.calls).toStrictEqual([
                ["The status could not read thread config daily-thread:", failure],
            ]);
        },
    );

    it(
        "reads a thread config named like an object property as having no records",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            freezeTime("2026-04-21T10:00:00Z");
            const config: ThreadConfig = { ...LOOSE_CONFIG, name: "constructor" };
            const fakes = statusWorld([config], {});

            const [status] = (await getThreadStatuses([config], fakes.ports)).threads;

            expect(
                status?.kind === "readable" ? [status.livePost, status.refreshStatus, status.handover] : undefined,
            ).toStrictEqual([{ kind: "none" }, NO_REFRESH_STATUS, undefined]);
        },
    );

    it("says when the hourly refresh check is not scheduled", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = statusWorld([], {});
        fakes.refreshJobs.hasHourlyCheck.mockResolvedValue(false);

        await expect(getThreadStatuses([], fakes.ports)).resolves.toStrictEqual({
            threads: [],
            disabled: [],
            hourlyCheckScheduled: false,
        });
    });
});

describe(findLivePostLink, (): void => {
    it("gives the thread config's live post ID and permalink", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = statusWorld([DAILY_CONFIG], {});
        fakes.livePosts.get.mockResolvedValue("t3_daily");

        await expect(findLivePostLink("daily-thread", fakes.ports)).resolves.toStrictEqual({
            postId: "t3_daily",
            permalink: "/r/testsub/comments/daily/",
        });
    });

    it("gives nothing for a thread config with no live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = statusWorld([DAILY_CONFIG], {});

        await expect(findLivePostLink("daily-thread", fakes.ports)).resolves.toBeUndefined();
        expect(fakes.posts.get).not.toHaveBeenCalled();
    });
});
