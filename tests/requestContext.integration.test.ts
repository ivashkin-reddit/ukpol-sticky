import { reddit, redis, scheduler } from "@devvit/web/server";
import { describe, expect } from "vitest";
import { requestContext } from "../src/server/requestContext.js";
import { TEST_APP_SLUG, TEST_SUBREDDIT_ID, TEST_SUBREDDIT_NAME } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

describe(requestContext, (): void => {
    devvitIt("names the request's subreddit and app, with Devvit Web's clients", TEST_OPTIONS, (): void => {
        expect.assertions(4);

        const { reddit: contextReddit, redis: contextRedis, scheduler: contextScheduler, ...names } = requestContext();

        expect(names).toStrictEqual({
            appSlug: TEST_APP_SLUG,
            subredditId: TEST_SUBREDDIT_ID,
            subredditName: TEST_SUBREDDIT_NAME,
        });
        expect(contextReddit).toBe(reddit);
        expect(contextRedis).toBe(redis);
        expect(contextScheduler).toBe(scheduler);
    });
});
