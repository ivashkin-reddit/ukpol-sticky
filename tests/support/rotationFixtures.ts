import type { ThreadConfig } from "../../src/configuration/index.js";
import type { NewComment } from "../../src/rotation/index.js";
import { createFakePost } from "./fakePosts.js";
import type { FakePost } from "./fakePosts.js";

// Thread configs, posts and failures shared by the rotation use-case tests.

/** The comment cap of every fixture thread config. */
export const COMMENT_CAP = 100;

export const STICKY_CONFIG: ThreadConfig = {
    name: "sticky-thread",
    enabled: true,
    title: "Sticky thread",
    maxComments: COMMENT_CAP,
    body: "Sticky body",
    sticky: true,
};

export const LOOSE_CONFIG: ThreadConfig = {
    name: "loose-thread",
    enabled: true,
    title: "Loose thread",
    maxComments: COMMENT_CAP,
    body: "Loose body",
};

export const DISABLED_CONFIG: ThreadConfig = {
    name: "disabled-thread",
    enabled: false,
    title: "Disabled thread",
    maxComments: COMMENT_CAP,
    body: "Disabled body",
};

/** A thread config rotated daily at 12:30. */
export const DAILY_CONFIG: ThreadConfig = {
    name: "daily-thread",
    enabled: true,
    title: "Daily thread",
    frequency: "daily",
    postTime: "12:30",
    maxComments: COMMENT_CAP,
    body: "Daily body",
};

export const PUBLISH_ERROR = new Error("Reddit is down");

/** The moderator alert a failed refresh of the thread config sends, with the failure's `details`. */
export function threadFailureAlert(
    configName: string,
    details: string,
): Readonly<{ subject: string; bodyMarkdown: string }> {
    return {
        subject: `Sticky Manager could not refresh thread config ${configName}`,
        bodyMarkdown: [
            `A refresh of thread config ${configName} failed. If it interrupted a rotation, the thread is part-way through it: its old post may be unpinned and not yet replaced, or its new post not yet pinned and the old one not yet locked.`,
            "Sticky Manager tries again within 15 minutes and finishes any interrupted rotation. It sends no further alert about this thread config until it refreshes successfully.",
            `Details: ${details}`,
        ].join("\n\n"),
    };
}

/** The moderator alert a failure to check or schedule refreshes sends, with the failure's `details`. */
export function refreshFailureAlert(details: string): Readonly<{ subject: string; bodyMarkdown: string }> {
    return {
        subject: "Sticky Manager could not schedule its refreshes",
        bodyMarkdown: [
            "Sticky Manager could not check or schedule its refreshes, so a managed thread may not rotate on time.",
            "It tries again at the next hourly check. It sends no further alert of this kind until a check succeeds.",
            `Details: ${details}`,
        ].join("\n\n"),
    };
}

/** DAILY_CONFIG's live post, published at 05:00 on 2026-04-21 with its body up to date, so it is due at 12:30. */
export function dailyPost(id: string): FakePost {
    return createFakePost({
        body: "Daily body",
        createdAt: new Date("2026-04-21T05:00:00Z"),
        id,
        numberOfComments: 0,
    });
}

/** A post just published, with no comments. */
export function newPost(id: string): FakePost {
    return createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id,
        numberOfComments: 0,
    });
}

/** STICKY_CONFIG's live post, published at 09:00 with `numberOfComments` comments. */
export function fullPost(id: string, numberOfComments: number): FakePost {
    return createFakePost({
        body: "Sticky body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id,
        numberOfComments,
    });
}

/** A new comment on `postId`, whose event reports `reportedComments` (0: the event did not say). */
export function commentOn(postId: string, reportedComments = 0): NewComment {
    return { postId, reportedComments };
}
