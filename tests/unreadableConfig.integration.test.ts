import { redis } from "@devvit/web/server";
import { describe, expect, vi } from "vitest";
import { configReadPorts } from "../src/composition.js";
import { getThreadConfigs, storeThreadConfigs, UnreadableConfigError } from "../src/configuration/index.js";
import type { ConfigReadPorts } from "../src/configuration/index.js";
import { redisAlertLatch } from "../src/notifications/adapters/redisAlertLatch.js";
import { TEST_SUBREDDIT_ID } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";
import type { CreateModInboxConversation } from "./support/fakeDevvitContext.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

// The unreadable-config alert's latch, as the composition root names it.
const UNREADABLE_ALERT_KEY = "UnreadableConfigAlertSent";

const EXPECTED_ALERT = {
    subredditId: TEST_SUBREDDIT_ID,
    subject: "Sticky Manager cannot read its stored config",
    bodyMarkdown: [
        "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
        "Edit and save the wiki page stickymgr/config (any change will do) to store a fresh copy.",
        'Details: Stored configuration (Redis key "Configuration") is invalid: data must be array',
    ].join("\n\n"),
};

interface AlertingPorts {
    readonly ports: ConfigReadPorts;
    readonly createModInboxConversation: ReturnType<typeof vi.fn<CreateModInboxConversation>>;
}

/** Ports over the harness's real Redis, with modmail captured by a mock. */
async function storeUnreadableConfig(): Promise<AlertingPorts> {
    const createModInboxConversation = vi.fn<CreateModInboxConversation>().mockResolvedValue("conversation-id");
    await redis.set("Configuration", "{}");
    return {
        ports: configReadPorts({
            redis,
            reddit: { modMail: { createModInboxConversation } },
            subredditId: TEST_SUBREDDIT_ID,
        }),
        createModInboxConversation,
    };
}

describe("an unreadable stored config", (): void => {
    devvitIt(
        "alerts moderators once, and again after a fresh config was stored and then broke",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { ports, createModInboxConversation } = await storeUnreadableConfig();

            await expect(getThreadConfigs(ports)).rejects.toBeInstanceOf(UnreadableConfigError);
            await expect(getThreadConfigs(ports)).rejects.toBeInstanceOf(UnreadableConfigError);
            expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);

            await storeThreadConfigs([], ports);
            await redis.set("Configuration", "{}");

            await expect(getThreadConfigs(ports)).rejects.toBeInstanceOf(UnreadableConfigError);
            expect(createModInboxConversation).toHaveBeenNthCalledWith(2, EXPECTED_ALERT);
        },
    );

    devvitIt("sends one alert when two reads fail at the same time", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { ports, createModInboxConversation } = await storeUnreadableConfig();

        const outcomes = await Promise.allSettled([getThreadConfigs(ports), getThreadConfigs(ports)]);

        expect(
            outcomes.map((outcome: Readonly<PromiseSettledResult<unknown>>): string => outcome.status),
        ).toStrictEqual(["rejected", "rejected"]);
        expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);
    });

    devvitIt(
        "alerts once a claim whose sender died unsent has lapsed, ten minutes on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            const { ports, createModInboxConversation } = await storeUnreadableConfig();
            // An earlier reader claimed the alert, then died before sending it.
            await redisAlertLatch(redis, UNREADABLE_ALERT_KEY).claim();

            vi.setSystemTime(new Date("2026-04-21T10:09:59Z"));

            await expect(getThreadConfigs(ports)).rejects.toBeInstanceOf(UnreadableConfigError);

            vi.setSystemTime(new Date("2026-04-21T10:10:01Z"));
            await getThreadConfigs(ports).catch((): undefined => undefined);

            expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);
        },
    );

    devvitIt(
        "keeps a sent alert's claim until fresh thread configs are stored, however long that takes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            freezeTime("2026-04-21T10:00:00Z");
            const { ports, createModInboxConversation } = await storeUnreadableConfig();

            await expect(getThreadConfigs(ports)).rejects.toBeInstanceOf(UnreadableConfigError);
            // -1: the key has no expiry.
            await expect(redis.expireTime(UNREADABLE_ALERT_KEY)).resolves.toBe(-1);

            vi.setSystemTime(new Date("2026-04-22T10:00:00Z"));
            await getThreadConfigs(ports).catch((): undefined => undefined);

            expect(createModInboxConversation).toHaveBeenCalledExactlyOnceWith(EXPECTED_ALERT);
        },
    );
});
