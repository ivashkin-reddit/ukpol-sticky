import { describe, expect, it } from "vitest";
import type { ConfigPageStatus } from "./configuration/index.js";
import type { AttentionReason, ReadableThreadStatus, ThreadStatuses } from "./rotation/index.js";
import {
    cut,
    describeAttention,
    describeComments,
    describeConfigPage,
    describeLastRefresh,
    describeLivePost,
    describeNextRefresh,
    describeShownStatus,
    describeSummary,
    formatTime,
} from "./statusText.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-04-21T10:00:00Z");

const HEALTHY: ReadableThreadStatus = {
    kind: "readable",
    configName: "daily-thread",
    hasSchedule: true,
    livePost: {
        kind: "readable",
        id: "t3_daily",
        title: "Daily thread",
        stickied: true,
        createdAt: new Date("2026-04-21T05:00:00Z"),
        comments: 12,
        commentCap: 100,
    },
    refreshStatus: {
        lastRefresh: { at: new Date("2026-04-21T05:00:00Z"), outcome: "succeeded" },
        lastSuccessAt: new Date("2026-04-21T05:00:00Z"),
        nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
        nextRefreshReason: "to rotate it",
    },
    handover: undefined,
    attention: [],
};

const FAILING: ReadableThreadStatus = {
    ...HEALTHY,
    configName: "loose-thread",
    attention: [{ kind: "failed" }, { kind: "check", finding: { kind: "no live post" } }],
};

const NO_NEXT_REFRESH: ReadableThreadStatus["refreshStatus"] = {
    ...HEALTHY.refreshStatus,
    nextRefreshAt: undefined,
    nextRefreshReason: undefined,
};

function readable(page: ConfigPageStatus["page"]): ConfigPageStatus {
    return { page, threadConfigs: { kind: "readable", configs: [] } };
}

describe(formatTime, (): void => {
    it.for<readonly [string, string]>([
        ["2026-04-21T12:30:05Z", "2026-04-21 12:30 UTC (in 3 hours)"],
        ["2026-04-21T10:05:05Z", "2026-04-21 10:05 UTC (in 5 minutes)"],
        ["2026-04-21T09:08:00Z", "2026-04-21 09:08 UTC (52 minutes ago)"],
    ])("words %s as %s at 10:00", TEST_OPTIONS, ([at, text]: readonly [string, string]): void => {
        expect.assertions(1);

        expect(formatTime(new Date(at), NOW)).toBe(text);
    });
});

describe(cut, (): void => {
    it("keeps text of 500 characters, and cuts longer text to 500 ending in an ellipsis", TEST_OPTIONS, (): void => {
        expect.assertions(2);

        expect(cut("x".repeat(500))).toBe("x".repeat(500));
        expect(cut("x".repeat(600))).toBe(`${"x".repeat(499)}…`);
    });
});

describe(describeConfigPage, (): void => {
    it.for<readonly [ConfigPageStatus, string]>([
        [readable({ kind: "inForce", savedBy: "mod_user" }), "Its latest revision is in force, saved by /u/mod_user."],
        [readable({ kind: "inForce", savedBy: undefined }), "Its latest revision is in force."],
        [
            readable({ kind: "rejected", problem: { kind: "incompleteSchedule", configName: "x" } }),
            "Its latest revision was rejected: Config x must define both frequency and postTime, or omit both to refresh only when maxComments is reached. The thread configs from its last accepted revision stay in force.",
        ],
        [
            readable({ kind: "rejected", problem: undefined }),
            "Its latest revision was rejected; saving the page again applies it.",
        ],
        [
            readable({ kind: "unchecked" }),
            "Its latest revision has not been applied yet; the refresh check applies it within the hour.",
        ],
        [readable({ kind: "unavailable" }), "The config page could not be read."],
        [
            { page: { kind: "inForce", savedBy: undefined }, threadConfigs: { kind: "unreadable" } },
            "The stored thread configs cannot be read, so refreshes have stopped. Save the config page again to store a fresh copy.",
        ],
    ])("words %j", TEST_OPTIONS, ([status, text]: readonly [ConfigPageStatus, string]): void => {
        expect.assertions(1);

        expect(describeConfigPage(status)).toBe(text);
    });
});

describe(describeNextRefresh, (): void => {
    it("gives the time and why", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeNextRefresh(HEALTHY, NOW)).toBe("2026-04-21 12:30 UTC (in 3 hours), to rotate it");
    });

    it("gives the time alone for a record from before reasons were kept", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            describeNextRefresh(
                { ...HEALTHY, refreshStatus: { ...HEALTHY.refreshStatus, nextRefreshReason: undefined } },
                NOW,
            ),
        ).toBe("2026-04-21 12:30 UTC (in 3 hours)");
    });

    it("says a thread config with no schedule rotates only at its comment cap", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeNextRefresh({ ...HEALTHY, hasSchedule: false, refreshStatus: NO_NEXT_REFRESH }, NOW)).toBe(
            "None: only its comment cap rotates it",
        );
    });

    it("says when a thread config with a schedule has no refresh recorded", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(describeNextRefresh({ ...HEALTHY, refreshStatus: NO_NEXT_REFRESH }, NOW)).toBe("None scheduled");
    });
});

describe(describeLastRefresh, (): void => {
    it("words none, a success and a failure", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        const at = new Date("2026-04-21T09:50:00Z");

        expect(describeLastRefresh(undefined, NOW)).toBe("None yet");
        expect(describeLastRefresh({ at, outcome: "succeeded" }, NOW)).toBe(
            "Succeeded 2026-04-21 09:50 UTC (10 minutes ago)",
        );
        expect(describeLastRefresh({ at, outcome: "failed", failure: "Reddit is down" }, NOW)).toBe(
            "Failed 2026-04-21 09:50 UTC (10 minutes ago): Reddit is down",
        );
    });
});

describe(describeLivePost, (): void => {
    it("words a live post, none, and one Reddit could not give", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        expect(describeLivePost(HEALTHY.livePost, NOW)).toBe(
            "Daily thread (t3_daily), stickied, posted 2026-04-21 05:00 UTC (5 hours ago)",
        );
        expect(describeLivePost({ kind: "none" }, NOW)).toBe("None: a refresh publishes one.");
        expect(describeLivePost({ kind: "unreadable", postId: "t3_gone" }, NOW)).toBe(
            "Could not read t3_gone from Reddit.",
        );
    });
});

describe(describeComments, (): void => {
    it("counts comments against the cap, alone with no cap stored, or as unknown", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        const livePost = {
            kind: "readable",
            id: "t3_daily",
            title: "Daily thread",
            stickied: true,
            createdAt: new Date("2026-04-21T05:00:00Z"),
            comments: 412,
            commentCap: 1000,
        } as const;

        expect(describeComments(livePost)).toBe("412 of 1000");
        expect(describeComments({ ...livePost, commentCap: undefined })).toBe("412");
        expect(describeComments({ kind: "unreadable", postId: "t3_gone" })).toBe("Unknown");
    });
});

describe(describeAttention, (): void => {
    it("words each reason with what happens next", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const reasons: readonly AttentionReason[] = [
            { kind: "failed" },
            { kind: "check", finding: { kind: "stuck", stuckAt: new Date("2026-04-21T09:00:05Z") } },
            { kind: "check", finding: { kind: "missing" } },
            { kind: "check", finding: { kind: "unapplied" } },
            { kind: "check", finding: { kind: "no live post" } },
            { kind: "check", finding: { kind: "unfinished handover" } },
            { kind: "postUnreadable" },
        ];

        expect(reasons.map(describeAttention)).toStrictEqual([
            "Its last refresh failed; it is retried within 15 minutes.",
            "Its refresh due at 2026-04-21 09:00 UTC has not run; the refresh check replaces it within the hour.",
            "No refresh of it is pending; the refresh check requests one within the hour.",
            "Its saved thread config has not been applied; the refresh check requests a refresh within the hour.",
            "It has no live post; the refresh check requests a refresh within the hour.",
            "Its handover is unfinished and no retry is pending; the refresh check requests a refresh within the hour.",
            "Its live post could not be read from Reddit.",
        ]);
    });
});

describe(describeSummary, (): void => {
    it("counts thread configs running and needing attention", TEST_OPTIONS, (): void => {
        expect.assertions(2);

        const statuses: ThreadStatuses = { threads: [FAILING, HEALTHY], disabled: [], hourlyCheckScheduled: true };

        expect(describeSummary(statuses)).toBe("2 managed threads: 1 running, 1 needs attention.");
        expect(describeSummary({ threads: [HEALTHY], disabled: [], hourlyCheckScheduled: false })).toBe(
            "1 managed thread: 1 running, 0 need attention. The hourly refresh check is not scheduled; the next refresh starts it again.",
        );
    });
});

describe(describeShownStatus, (): void => {
    it("names who saw it, the counts, and each reason for attention", TEST_OPTIONS, (): void => {
        expect.assertions(3);

        expect(
            describeShownStatus("mod_user", {
                threads: [FAILING, { kind: "unreadable", configName: "weekly-thread" }, HEALTHY],
                disabled: [],
                hourlyCheckScheduled: true,
            }),
        ).toBe(
            "Showed the status to u/mod_user: 3 thread configs, 2 need attention (loose-thread: its last refresh failed, it has no live post; weekly-thread: its status could not be read).",
        );
        expect(describeShownStatus("mod_user", { threads: [HEALTHY], disabled: [], hourlyCheckScheduled: true })).toBe(
            "Showed the status to u/mod_user: 1 thread config, 0 need attention.",
        );
        expect(describeShownStatus("mod_user", undefined)).toBe(
            "Showed the status to u/mod_user: the stored thread configs cannot be read.",
        );
    });
});
