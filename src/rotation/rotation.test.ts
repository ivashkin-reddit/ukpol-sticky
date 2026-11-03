import { describe, expect, it, vi } from "vitest";
import { defer } from "../../tests/support/defer.js";
import { createFakePost, createFakeRotationContext } from "../../tests/support/fakeRotationContext.js";
import { UnreadableConfigError } from "../configuration/index.js";
import type { ThreadConfig } from "../configuration/index.js";
import { refreshAllThreads, rotateIfCapReached, scheduleNextRefresh } from "./rotation.js";
import type { ManagedPost } from "./rotation.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const STICKY_CONFIG: ThreadConfig = {
    name: "sticky-thread",
    enabled: true,
    title: "Sticky thread",
    maxComments: 100,
    body: "Sticky body",
    sticky: true,
};
const LOOSE_CONFIG: ThreadConfig = {
    name: "loose-thread",
    enabled: true,
    title: "Loose thread",
    maxComments: 100,
    body: "Loose body",
};
const DISABLED_CONFIG: ThreadConfig = {
    name: "disabled-thread",
    enabled: false,
    title: "Disabled thread",
    maxComments: 100,
    body: "Disabled body",
};

const UNREADABLE_STORED_CONFIGS = JSON.stringify([{ name: "missing-required-keys" }]);
const UNREADABLE_ERROR = new UnreadableConfigError(
    "Stored configuration (Redis key \"Configuration\") is invalid: data/0 must have required property 'enabled'",
);

function newPost(id: string): ReturnType<typeof createFakePost> {
    return createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id,
        numberOfComments: 0,
        stickied: false,
    });
}

function fullPost(id: string, numberOfComments: number): ReturnType<typeof createFakePost> {
    return createFakePost({
        body: "Sticky body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id,
        numberOfComments,
        stickied: true,
    });
}

/** A Redis GET implementation serving a fixed table of keys. */
function servingStrings(values: Readonly<Record<string, string>>): (key: string) => Promise<string | undefined> {
    return async (key: string): Promise<string | undefined> => await Promise.resolve(values[key]);
}

describe(refreshAllThreads, (): void => {
    it(
        "forgets every live post and its comment cap when no thread config is stored",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationContext();
            fakes.redis.get.mockResolvedValue("[]");
            fakes.redis.hGetAll.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

            await refreshAllThreads(fakes.context);

            expect(fakes.redis.hDel).toHaveBeenCalledExactlyOnceWith("StickyPostStore", ["alpha", "beta"]);
            expect(fakes.redis.del).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_alpha", "CommentCap:t3_beta");
            expect(logSpy).toHaveBeenCalledExactlyOnceWith("No sticky post configurations found.");
        },
    );

    it(
        "fails, keeps every live post and alerts moderators when the stored thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeRotationContext();
            fakes.redis.get.mockResolvedValue(UNREADABLE_STORED_CONFIGS);
            fakes.redis.hGetAll.mockResolvedValue({ alpha: "t3_alpha" });

            await expect(refreshAllThreads(fakes.context)).rejects.toThrow(UNREADABLE_ERROR);
            expect(fakes.redis.hDel).not.toHaveBeenCalled();
            expect(fakes.redis.del).not.toHaveBeenCalled();
            expect(fakes.reddit.modMail.createModInboxConversation.mock.lastCall?.[0].subject).toBe(
                "Sticky Manager cannot read its stored config",
            );
        },
    );

    it(
        "publishes live posts for enabled thread configs one at a time, sticky first",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.hasAssertions();

            vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
            const fakes = createFakeRotationContext("ukpolitics");
            fakes.redis.get.mockResolvedValue(JSON.stringify([LOOSE_CONFIG, DISABLED_CONFIG, STICKY_CONFIG]));
            const stickyPost = newPost("t3_sticky");
            const loosePost = newPost("t3_loose");
            const stickySubmission = defer<ManagedPost>();
            fakes.reddit.submitPost.mockReturnValueOnce(stickySubmission.promise).mockResolvedValueOnce(loosePost.post);

            const refresh = refreshAllThreads(fakes.context);
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

    it("rotates a live post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationContext("ukpolitics");
        fakes.redis.get.mockResolvedValue(JSON.stringify([STICKY_CONFIG]));
        fakes.redis.hGet.mockResolvedValue("t3_full");
        const full = fullPost("t3_full", 100);
        fakes.reddit.getPostById.mockResolvedValue(full.post);
        fakes.reddit.submitPost.mockResolvedValue(newPost("t3_next").post);

        await refreshAllThreads(fakes.context);

        expect(full.unsticky).toHaveBeenCalledExactlyOnceWith();
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
        "fails without cancelling pending refreshes when the stored thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeRotationContext();
            fakes.redis.get.mockResolvedValue(UNREADABLE_STORED_CONFIGS);
            fakes.scheduler.listJobs.mockResolvedValue([
                {
                    id: "refresh-1",
                    name: "RefreshStickyPosts",
                    data: undefined,
                    runAt: new Date("2026-04-21T12:30:05Z"),
                },
            ]);

            await expect(scheduleNextRefresh(fakes.context)).rejects.toThrow(UNREADABLE_ERROR);
            expect(fakes.scheduler.cancelJob).not.toHaveBeenCalled();
        },
    );
});

describe(rotateIfCapReached, (): void => {
    it("does nothing for a post without a stored comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationContext();

        await rotateIfCapReached("t3_other", fakes.context);

        expect(fakes.redis.get).toHaveBeenCalledExactlyOnceWith("CommentCap:t3_other");
        expect(fakes.reddit.getPostById).not.toHaveBeenCalled();
    });

    it("leaves a live post below its comment cap alone", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationContext();
        fakes.redis.get.mockImplementation(servingStrings(Object.fromEntries([["CommentCap:t3_full", "100"]])));
        fakes.reddit.getPostById.mockResolvedValue(fullPost("t3_full", 99).post);

        await rotateIfCapReached("t3_full", fakes.context);

        expect(fakes.reddit.getPostById).toHaveBeenCalledExactlyOnceWith("t3_full");
        expect(fakes.reddit.submitPost).not.toHaveBeenCalled();
    });

    it("rotates a live post that has reached its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationContext("ukpolitics");
        fakes.redis.get.mockImplementation(
            servingStrings(
                Object.fromEntries([
                    ["CommentCap:t3_full", "100"],
                    ["Configuration", JSON.stringify([STICKY_CONFIG])],
                ]),
            ),
        );
        fakes.redis.hGetAll.mockResolvedValue({ "sticky-thread": "t3_full" });
        fakes.redis.hGet.mockResolvedValue("t3_full");
        const full = fullPost("t3_full", 100);
        fakes.reddit.getPostById.mockResolvedValue(full.post);
        fakes.reddit.submitPost.mockResolvedValue(newPost("t3_next").post);

        await rotateIfCapReached("t3_full", fakes.context);

        expect(logSpy).toHaveBeenNthCalledWith(1, "Post t3_full has reached the comment cap of 100.");
        expect(full.unsticky).toHaveBeenCalledExactlyOnceWith();
        expect(fakes.redis.hSet).toHaveBeenCalledExactlyOnceWith("StickyPostStore", { "sticky-thread": "t3_next" });
    });
});
