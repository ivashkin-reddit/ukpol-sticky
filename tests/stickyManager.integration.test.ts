/* eslint-disable vitest/no-standalone-expect */

import { createDevvitTest } from "@devvit/test/server/vitest";
import { reddit } from "@devvit/reddit";
import { redis } from "@devvit/redis";
import { scheduler, type ScheduledJob as ScheduledListJob } from "@devvit/scheduler";
import { afterEach, expect, vi } from "vitest";
import type { Config } from "../src/config.js";
import { ScheduledJob } from "../src/constants.js";
import { handlePostDelete, refreshStickyPosts, scheduleNextRefresh } from "../src/stickyManager.js";

const test = createDevvitTest();
const TEST_ENV = {
    subredditId: "t5_testsub",
    subredditName: "testsub",
} as const;
const refreshStickyPostsJobName = ScheduledJob.RefreshStickyPosts as string;

afterEach(() => {
    vi.useRealTimers();
});

function createContext () {
    return {
        reddit,
        redis,
        scheduler,
        subredditId: TEST_ENV.subredditId,
        subredditName: TEST_ENV.subredditName,
    };
}

async function storeConfig (config: Config[]) {
    await redis.set("Configuration", JSON.stringify(config));
}

function isRefreshJob (job: Awaited<ReturnType<typeof scheduler.listJobs>>[number]): job is ScheduledListJob {
    return "runAt" in job && job.name === refreshStickyPostsJobName;
}

test("scheduleNextRefresh cancels prior refresh jobs and schedules the earliest tracked refresh", async ({ mocks }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Daily body",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "daily-thread",
            postTime: "12:30",
            sticky: true,
            title: "Daily thread",
        },
        {
            body: "Weekly body",
            enabled: true,
            frequency: "wednesdays",
            maxComments: 200,
            name: "weekly-thread",
            postTime: "08:00",
            sticky: true,
            title: "Weekly thread",
        },
        {
            body: "Cap body",
            enabled: true,
            maxComments: 200,
            name: "cap-thread",
            sticky: true,
            title: "Cap thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "cap-thread": "t3_capthread",
        "daily-thread": "t3_dailythread",
        "weekly-thread": "t3_weeklythread",
    });

    mocks.reddit.linksAndComments.addPost({
        createdUtc: Math.floor(new Date("2026-04-21T05:00:00Z").getTime() / 1000),
        id: "t3_dailythread",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Daily thread",
    });
    mocks.reddit.linksAndComments.addPost({
        createdUtc: Math.floor(new Date("2026-04-15T09:00:00Z").getTime() / 1000),
        id: "t3_weeklythread",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Weekly thread",
    });
    mocks.reddit.linksAndComments.addPost({
        createdUtc: Math.floor(new Date("2026-04-21T07:00:00Z").getTime() / 1000),
        id: "t3_capthread",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Cap thread",
    });

    const replacedJobId = await scheduler.runJob({
        name: ScheduledJob.RefreshStickyPosts,
        runAt: new Date("2026-04-21T09:30:00Z"),
    });
    const retainedJobId = await scheduler.runJob({
        name: "keep-me",
        runAt: new Date("2026-04-22T00:00:00Z"),
    });

    await scheduleNextRefresh(createContext() as never);

    const jobs = await scheduler.listJobs();
    expect(jobs.find(job => job.id === replacedJobId)).toBeUndefined();
    expect(jobs.find(job => job.id === retainedJobId)?.name).toBe("keep-me");

    const refreshJobs = jobs.filter(isRefreshJob);
    expect(refreshJobs).toHaveLength(1);
    expect(refreshJobs[0]?.runAt.toISOString()).toBe("2026-04-21T12:30:05.000Z");
});

test("scheduleNextRefresh removes stale refresh jobs when no tracked schedule remains", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Cap body",
            enabled: true,
            maxComments: 200,
            name: "cap-thread",
            sticky: true,
            title: "Cap thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "cap-thread": "t3_capthread",
    });

    await scheduler.runJob({
        name: ScheduledJob.RefreshStickyPosts,
        runAt: new Date("2026-04-21T14:00:00Z"),
    });
    await scheduler.runJob({
        name: "keep-me",
        runAt: new Date("2026-04-22T00:00:00Z"),
    });

    await scheduleNextRefresh(createContext() as never);

    const jobs = await scheduler.listJobs();
    expect(jobs.filter(isRefreshJob)).toHaveLength(0);
    expect(jobs.filter(job => job.name === "keep-me")).toHaveLength(1);
});

test("scheduleNextRefresh runs overdue refreshes immediately", async ({ mocks }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Daily body",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "daily-thread",
            postTime: "04:00",
            sticky: true,
            title: "Daily thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "daily-thread": "t3_dailythread",
    });

    mocks.reddit.linksAndComments.addPost({
        createdUtc: Math.floor(new Date("2026-04-19T08:00:00Z").getTime() / 1000),
        id: "t3_dailythread",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Daily thread",
    });

    await scheduleNextRefresh(createContext() as never);

    const jobs = await scheduler.listJobs();
    const refreshJobs = jobs.filter(isRefreshJob);
    expect(refreshJobs).toHaveLength(1);
    expect(refreshJobs[0]?.runAt.toISOString()).toBe("2026-04-21T10:00:05.000Z");
});

test("refreshStickyPosts removes stale tracked state and preserves the active thread", async ({ mocks }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Active body",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "active-thread",
            postTime: "12:30",
            sticky: true,
            title: "Active thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "active-thread": "t3_active",
        "stale-thread": "t3_stale",
    });
    await redis.set("CommentCap:t3_stale", JSON.stringify(150));

    mocks.reddit.linksAndComments.addPost({
        body: "Active body",
        createdUtc: Math.floor(new Date("2026-04-21T05:00:00Z").getTime() / 1000),
        id: "t3_active",
        numComments: 10,
        selftext: "Active body",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Active thread",
    });

    await refreshStickyPosts({} as never, createContext() as never);

    expect(await redis.hGetAll("StickyPostStore")).toEqual({
        "active-thread": "t3_active",
    });
    expect(await redis.get("CommentCap:t3_stale")).toBeUndefined();
    expect(await redis.get("CommentCap:t3_active")).toBe(JSON.stringify(200));

    const refreshJobs = (await scheduler.listJobs()).filter(isRefreshJob);
    expect(refreshJobs).toHaveLength(1);
    expect(refreshJobs[0]?.runAt.toISOString()).toBe("2026-04-21T12:30:05.000Z");
});

test("refreshStickyPosts updates the body of an active tracked post without rotating it", async ({ mocks }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Updated body",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "active-thread",
            postTime: "12:30",
            sticky: true,
            title: "Active thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "active-thread": "t3_active",
    });

    mocks.reddit.linksAndComments.addPost({
        body: "Old body",
        createdUtc: Math.floor(new Date("2026-04-21T05:00:00Z").getTime() / 1000),
        id: "t3_active",
        numComments: 10,
        selftext: "Old body",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Active thread",
    });

    await refreshStickyPosts({} as never, createContext() as never);

    const updatedPost = await reddit.getPostById("t3_active");
    expect(updatedPost.body?.trim()).toBe("Updated body");
    expect(await redis.hGetAll("StickyPostStore")).toEqual({
        "active-thread": "t3_active",
    });
    expect(await redis.get("CommentCap:t3_active")).toBe(JSON.stringify(200));

    const refreshJobs = (await scheduler.listJobs()).filter(isRefreshJob);
    expect(refreshJobs).toHaveLength(1);
    expect(refreshJobs[0]?.runAt.toISOString()).toBe("2026-04-21T12:30:05.000Z");
});

test("refreshStickyPosts removes disabled tracked configs and ignores them for future scheduling", async ({ mocks }) => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

    await storeConfig([
        {
            body: "Active body",
            enabled: true,
            frequency: "daily",
            maxComments: 200,
            name: "active-thread",
            postTime: "12:30",
            sticky: true,
            title: "Active thread",
        },
        {
            body: "Disabled body",
            enabled: false,
            frequency: "daily",
            maxComments: 200,
            name: "disabled-thread",
            postTime: "12:00",
            sticky: true,
            title: "Disabled thread",
        },
    ]);

    await redis.hSet("StickyPostStore", {
        "active-thread": "t3_active",
        "disabled-thread": "t3_disabled",
    });
    await redis.set("CommentCap:t3_disabled", JSON.stringify(150));

    mocks.reddit.linksAndComments.addPost({
        body: "Active body",
        createdUtc: Math.floor(new Date("2026-04-21T05:00:00Z").getTime() / 1000),
        id: "t3_active",
        numComments: 10,
        selftext: "Active body",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Active thread",
    });
    mocks.reddit.linksAndComments.addPost({
        body: "Disabled body",
        createdUtc: Math.floor(new Date("2026-04-21T05:00:00Z").getTime() / 1000),
        id: "t3_disabled",
        numComments: 10,
        selftext: "Disabled body",
        subreddit: TEST_ENV.subredditName,
        subredditId: TEST_ENV.subredditId,
        title: "Disabled thread",
    });

    await refreshStickyPosts({} as never, createContext() as never);

    expect(await redis.hGetAll("StickyPostStore")).toEqual({
        "active-thread": "t3_active",
    });
    expect(await redis.get("CommentCap:t3_disabled")).toBeUndefined();

    const refreshJobs = (await scheduler.listJobs()).filter(isRefreshJob);
    expect(refreshJobs).toHaveLength(1);
    expect(refreshJobs[0]?.runAt.toISOString()).toBe("2026-04-21T12:30:05.000Z");
});

test("handlePostDelete removes sticky tracking and the stored comment cap", async () => {
    await redis.hSet("StickyPostStore", {
        alpha: "t3_alpha",
        beta: "t3_beta",
    });
    await redis.set("CommentCap:t3_alpha", JSON.stringify(150));
    await redis.set("CommentCap:t3_beta", JSON.stringify(250));

    await handlePostDelete({ postId: "t3_alpha" } as never, createContext() as never);

    expect(await redis.hGetAll("StickyPostStore")).toEqual({
        beta: "t3_beta",
    });
    expect(await redis.get("CommentCap:t3_alpha")).toBeUndefined();
    expect(await redis.get("CommentCap:t3_beta")).toBe(JSON.stringify(250));
});
