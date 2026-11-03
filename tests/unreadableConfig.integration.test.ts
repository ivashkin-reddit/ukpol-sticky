import { redis } from "@devvit/redis";
import { describe, expect, vi } from "vitest";
import { getConfig, storeConfig, UnreadableConfigError } from "../src/config.js";
import type { ConfigReadContext } from "../src/config.js";
import { TEST_SUBREDDIT_ID } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import type { CreateModInboxConversation } from "./support/fakeStickyContext.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

const EXPECTED_ALERT = {
    subredditId: TEST_SUBREDDIT_ID,
    subject: "Sticky Manager cannot read its stored config",
    bodyMarkdown: [
        "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
        "Re-save the wiki page stickymgr/config to store a fresh copy.",
        "Details: Stored configuration (Redis key \"Configuration\") is invalid: data must be array",
    ].join("\n\n"),
};

interface AlertingContext {
    readonly context: ConfigReadContext;
    readonly createModInboxConversation: ReturnType<typeof vi.fn<CreateModInboxConversation>>;
}

/** The harness's real Redis, with modmail captured by a mock. */
async function storeUnreadableConfig (): Promise<AlertingContext> {
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");
    await redis.set("Configuration", "{}");
    return { context: { redis, reddit: { modMail: { createModInboxConversation } }, subredditId: TEST_SUBREDDIT_ID }, createModInboxConversation };
}

describe("an unreadable stored config", (): void => {
    devvitIt("alerts moderators once, and again after a fresh config was stored and then broke", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(5);

        const { context, createModInboxConversation } = await storeUnreadableConfig();

        await expect(getConfig(context)).rejects.toBeInstanceOf(UnreadableConfigError);
        await expect(getConfig(context)).rejects.toBeInstanceOf(UnreadableConfigError);
        expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);

        await storeConfig(context, []);
        await redis.set("Configuration", "{}");

        await expect(getConfig(context)).rejects.toBeInstanceOf(UnreadableConfigError);
        expect(createModInboxConversation).toHaveBeenNthCalledWith(2, EXPECTED_ALERT);
    });

    devvitIt("sends one alert when two reads fail at the same time", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { context, createModInboxConversation } = await storeUnreadableConfig();

        const outcomes = await Promise.allSettled([getConfig(context), getConfig(context)]);

        expect(outcomes.map((outcome: Readonly<PromiseSettledResult<unknown>>): string => outcome.status)).toStrictEqual(["rejected", "rejected"]);
        expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);
    });
});
