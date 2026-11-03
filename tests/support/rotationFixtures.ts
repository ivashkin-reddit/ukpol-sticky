import type { ThreadConfig } from "../../src/configuration/index.js";
import { createFakePost } from "./fakeRotationPorts.js";
import type { FakePost } from "./fakeRotationPorts.js";

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

export const PUBLISH_ERROR = new Error("Reddit is down");

/** The moderator alert a refresh failing with PUBLISH_ERROR sends. */
export const FAILURE_ALERT = {
    subject: "Sticky Manager could not refresh its threads",
    bodyMarkdown: [
        "A refresh of the managed threads failed. A thread that was rotating may have lost its live post: the old one unstickied and locked, with no replacement yet.",
        "Sticky Manager tries again within the hour, and sends no further alert until a refresh succeeds.",
        "Details: Reddit is down",
    ].join("\n\n"),
};

/** A post just published, with no comments. */
export function newPost(id: string): FakePost {
    return createFakePost({
        body: undefined,
        createdAt: new Date("2026-04-21T10:00:00Z"),
        id,
        numberOfComments: 0,
        stickied: false,
    });
}

/** STICKY_CONFIG's live post, published at 09:00 with `numberOfComments` comments. */
export function fullPost(id: string, numberOfComments: number): FakePost {
    return createFakePost({
        body: "Sticky body",
        createdAt: new Date("2026-04-21T09:00:00Z"),
        id,
        numberOfComments,
        stickied: true,
    });
}
