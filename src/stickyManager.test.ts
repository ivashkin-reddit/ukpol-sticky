import { describe, expect, it, vi } from "vitest";
import { defer } from "../tests/support/defer.js";
import { createFakePost, createFakeStickyContext } from "../tests/support/fakeStickyContext.js";
import { UnreadableConfigError } from "./config.js";
import type { Config, ScheduleFrequency } from "./config.js";
import { getRefreshTime, refreshStickyPosts, scheduleNextRefresh } from "./stickyManager.js";
import type { ManagedPost } from "./stickyManager.js";

const TEST_OPTIONS = { timeout: 1000 };

const UNSCHEDULED_CONFIG: Config = {
    name: "cap-thread",
    enabled: true,
    title: "Cap thread",
    maxComments: 200,
    body: "Body",
};

interface RefreshCase {
    readonly frequency: ScheduleFrequency;
    readonly postTime: string;
    readonly postedAt: string;
    readonly refreshesAt: string;
}

const REFRESH_CASES: readonly RefreshCase[] = [
    {
        frequency: "daily",
        postTime: "14:00",
        postedAt: "2023-02-02T02:00:00Z",
        refreshesAt: "2023-02-02T14:00:00.000Z",
    },
    {
        frequency: "daily",
        postTime: "14:30",
        postedAt: "2023-02-02T02:00:00Z",
        refreshesAt: "2023-02-02T14:30:00.000Z",
    },
    {
        frequency: "daily",
        postTime: "12:30",
        postedAt: "2026-04-21T05:00:00Z",
        refreshesAt: "2026-04-21T12:30:00.000Z",
    },
    // Posted less than six hours before today's slot, so it runs until tomorrow's.
    {
        frequency: "daily",
        postTime: "14:00",
        postedAt: "2023-02-01T13:00:00Z",
        refreshesAt: "2023-02-02T14:00:00.000Z",
    },
    {
        frequency: "wednesdays",
        postTime: "01:00",
        postedAt: "2025-02-06T12:00:00Z",
        refreshesAt: "2025-02-12T01:00:00.000Z",
    },
    {
        frequency: "wednesdays",
        postTime: "01:30",
        postedAt: "2025-02-06T12:00:00Z",
        refreshesAt: "2025-02-12T01:30:00.000Z",
    },
    // Posted on its own weekday, so it runs until the same weekday next week.
    {
        frequency: "wednesdays",
        postTime: "01:00",
        postedAt: "2025-02-12T00:30:00Z",
        refreshesAt: "2025-02-19T01:00:00.000Z",
    },
];

describe(getRefreshTime, (): void => {
    it("returns undefined for a config without a schedule", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(getRefreshTime(new Date("2023-02-02T02:00:00Z"), UNSCHEDULED_CONFIG)).toBeUndefined();
    });

    it("returns undefined when postTime was left empty", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            getRefreshTime(new Date("2023-02-02T02:00:00Z"), {
                ...UNSCHEDULED_CONFIG,
                frequency: "daily",
                postTime: null,
            }),
        ).toBeUndefined();
    });

    it.for(REFRESH_CASES)(
        "schedules $frequency at $postTime, posted $postedAt, for $refreshesAt",
        TEST_OPTIONS,
        (refreshCase: RefreshCase): void => {
            expect.assertions(1);

            const config: Config = {
                ...UNSCHEDULED_CONFIG,
                frequency: refreshCase.frequency,
                postTime: refreshCase.postTime,
            };

            expect(getRefreshTime(new Date(refreshCase.postedAt), config)?.toISOString()).toBe(refreshCase.refreshesAt);
        },
    );
});

const STICKY_CONFIG: Config = {
    name: "sticky-thread",
    enabled: true,
    title: "Sticky thread",
    maxComments: 100,
    body: "Sticky body",
    sticky: true,
};
const LOOSE_CONFIG: Config = {
    name: "loose-thread",
    enabled: true,
    title: "Loose thread",
    maxComments: 100,
    body: "Loose body",
};
const DISABLED_CONFIG: Config = {
    name: "disabled-thread",
    enabled: false,
    title: "Disabled thread",
    maxComments: 100,
    body: "Disabled body",
};

function newPost(id: string): ReturnType<typeof createFakePost> {
    return createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id,
        numberOfComments: 0,
        stickied: false,
    });
}

describe(refreshStickyPosts, (): void => {
    it(
        "forgets every tracked post and its comment cap when no config is stored",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeStickyContext();
            fakes.redis.get.mockResolvedValue("[]");
            fakes.redis.hGetAll.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

            await refreshStickyPosts({}, fakes.context);

            expect(fakes.redis.hDel).toHaveBeenCalledExactlyOnceWith("StickyPostStore", ["alpha", "beta"]);
            expect(fakes.redis.del).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha", "CommentCap:t3_beta");
            expect(logSpy).toHaveBeenCalledExactlyOnceWith("No sticky post configurations found.");
        },
    );

    it(
        "fails, keeps every tracked post and alerts moderators when the stored config cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeStickyContext();
            fakes.redis.get.mockResolvedValue(JSON.stringify([{ name: "missing-required-keys" }]));
            fakes.redis.hGetAll.mockResolvedValue({ alpha: "t3_alpha" });

            await expect(refreshStickyPosts({}, fakes.context)).rejects.toThrow(
                new UnreadableConfigError(
                    "Stored configuration (Redis key \"Configuration\") is invalid: data/0 must have required property 'enabled'",
                ),
            );
            expect(fakes.redis.hDel).not.toHaveBeenCalled();
            expect(fakes.redis.del).not.toHaveBeenCalled();
            expect(fakes.reddit.modMail.createModInboxConversation.mock.lastCall?.[0].subject).toBe(
                "Sticky Manager cannot read its stored config",
            );
        },
    );

    it(
        "creates posts for enabled configs one at a time, sticky configs first",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeStickyContext("ukpolitics");
            fakes.redis.get.mockResolvedValue(JSON.stringify([LOOSE_CONFIG, DISABLED_CONFIG, STICKY_CONFIG]));
            const stickyPost = newPost("t3_sticky");
            const loosePost = newPost("t3_loose");
            const stickySubmission = defer<ManagedPost>();
            fakes.reddit.submitPost.mockReturnValueOnce(stickySubmission.promise).mockResolvedValueOnce(loosePost.post);

            const refresh = refreshStickyPosts({}, fakes.context);
            // While the sticky post's submission is pending, no other post may be submitted.
            await vi.waitFor((): void => {
                expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({
                    title: "Sticky thread",
                    text: "Sticky body",
                    subredditName: "ukpolitics",
                });
            });
            stickySubmission.resolve(stickyPost.post);
            await refresh;

            expect(fakes.reddit.submitPost).toHaveBeenNthCalledWith(2, {
                title: "Loose thread",
                text: "Loose body",
                subredditName: "ukpolitics",
            });
            expect(fakes.reddit.submitPost).toHaveBeenCalledTimes(2);
            expect(stickyPost.sticky).toHaveBeenCalledExactlyOnceWith();
            expect(loosePost.sticky).not.toHaveBeenCalled();
        },
    );

    it("replaces a tracked post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeStickyContext("ukpolitics");
        fakes.redis.get.mockResolvedValue(JSON.stringify([STICKY_CONFIG]));
        fakes.redis.hGet.mockResolvedValue("t3_full");
        const fullPost = createFakePost({
            body: "Sticky body",
            createdAt: new Date("2026-04-21T09:00:00Z"),
            id: "t3_full",
            numberOfComments: 100,
            stickied: true,
        });
        fakes.reddit.getPostById.mockResolvedValue(fullPost.post);
        fakes.reddit.submitPost.mockResolvedValue(newPost("t3_next").post);

        await refreshStickyPosts({}, fakes.context);

        expect(fullPost.unsticky).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.reddit.submitPost).toHaveBeenCalledExactlyOnceWith({
            title: "Sticky thread",
            text: "Sticky body",
            subredditName: "ukpolitics",
        });
        expect(fakes.redis.hSet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", { "sticky-thread": "t3_next" });
    });
});

describe(scheduleNextRefresh, (): void => {
    it(
        "fails without cancelling pending refresh jobs when the stored config cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeStickyContext();
            fakes.redis.get.mockResolvedValue(JSON.stringify([{ name: "missing-required-keys" }]));
            fakes.scheduler.listJobs.mockResolvedValue([
                {
                    id: "refresh-1",
                    name: "RefreshStickyPosts",
                    data: undefined,
                    runAt: new Date("2026-04-21T12:30:05Z"),
                },
            ]);

            await expect(scheduleNextRefresh(fakes.context)).rejects.toThrow(
                new UnreadableConfigError(
                    "Stored configuration (Redis key \"Configuration\") is invalid: data/0 must have required property 'enabled'",
                ),
            );
            expect(fakes.scheduler.cancelJob).not.toHaveBeenCalled();
        },
    );
});
