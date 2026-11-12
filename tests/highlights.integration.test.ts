import { redis } from "@devvit/web/server";
import { T3 as asPostId } from "@devvit/web/shared";
import { describe, expect, vi } from "vitest";
import { configReadPorts, rotationPorts } from "../src/composition.js";
import { storeThreadConfigs } from "../src/configuration/index.js";
import type { ThreadConfig } from "../src/configuration/index.js";
import { refreshThreadConfig } from "../src/rotation/index.js";
import { submitPostAt } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeDate } from "./support/fakeClock.js";
import { VALID_CONFIG_PAGE } from "./support/fakeConfigurationPorts.js";
import { readHarnessHighlights, writeHarnessHighlights } from "./support/harnessHighlights.js";
import type { HarnessHighlight } from "./support/harnessHighlights.js";
import { createHarnessWorld } from "./support/harnessWorld.js";
import type { HarnessWorld } from "./support/harnessWorld.js";
import { silenceConsole } from "./support/silenceConsole.js";

// Highlights on Devvit's harness, through the composition root and the routes: a rotation keeps its thread config's
// slot, and "Pin to slot" pins a post, asks before Reddit would unpin one, and records each change once.

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

const WEEKLY: ThreadConfig = {
    name: "weekly",
    enabled: true,
    title: "Weekly",
    frequency: "daily",
    postTime: "12:30",
    maxComments: 200,
    body: "Body",
    slot: 1,
};

/** A world at 10:00 with a post titled `title` published at 09:00; returns its ID. */
async function worldWithPost(title: string): Promise<Readonly<{ world: HarnessWorld; postId: string }>> {
    freezeDate("2026-04-21T10:00:00Z");
    silenceConsole("log");
    const world = createHarnessWorld(VALID_CONFIG_PAGE);
    const postId = await submitPostAt("2026-04-21T09:00:00Z", title, "Body");
    vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));
    return { world, postId };
}

/** The labels-and-IDs of the harness's highlights, in order. */
async function highlightIds(): Promise<readonly string[]> {
    return (await readHarnessHighlights()).map((entry: Readonly<{ postId: string }>): string => entry.postId);
}

describe("highlights on the harness", (): void => {
    devvitIt(
        "a rotation pins the new live post in its thread config's slot, above a post pinned by hand",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { world, postId: amaId } = await worldWithPost("AMA");
            await storeThreadConfigs([WEEKLY], configReadPorts(world.context));
            const liveId = await submitPostAt("2026-04-21T05:00:00Z", "Weekly", "Body");
            const ports = rotationPorts(world.context);
            await ports.livePosts.set("weekly", liveId);
            await ports.highlights.pin(amaId, "event");
            await ports.highlights.pin(liveId, "megathread");
            vi.setSystemTime(new Date("2026-04-21T12:31:00Z"));

            await refreshThreadConfig("weekly", ports);

            const newLiveId = await ports.livePosts.get("weekly");

            expect(newLiveId).not.toBe(liveId);
            await expect(readHarnessHighlights()).resolves.toStrictEqual([
                { postId: newLiveId, highlightLabel: "MEGATHREAD" },
                { postId: amaId, highlightLabel: "EVENT" },
            ]);
        },
    );

    devvitIt(
        "pinning to a slot, delivered twice, pins the post once and records one change, which the status shows",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { world, postId } = await worldWithPost("AMA");
            const choice = { post: [postId], slot: ["1"], label: ["event"] };

            const menu = await world.deliver("/internal/menu/pin", { location: "post", targetId: postId });
            const first = await world.deliver("/internal/forms/pin", choice);
            const second = await world.deliver("/internal/forms/pin", choice);

            expect(menu.body).toHaveProperty("showForm.name", "pinForm");
            expect([first.body, second.body]).toStrictEqual([
                { showToast: 'Pinned "AMA" to slot 1.' },
                { showToast: "Nothing to change." },
            ]);
            await expect(highlightIds()).resolves.toStrictEqual([postId]);
            await expect(redis.zRange("ChangeHistory", 0, -1, { by: "rank" })).resolves.toHaveLength(1);

            const status = await world.deliver("/internal/menu/status", {});

            expect(JSON.stringify(status.body)).toContain('u/mod_user pinned \\"AMA\\" to slot 1 (Event).');
        },
    );

    devvitIt(
        "pinning to a slot asks before Reddit would unpin a post, then pins it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { world, postId } = await worldWithPost("AMA");
            // Six others pinned, A to F in display order.
            const others = await Promise.all(
                ["A", "B", "C", "D", "E", "F"].map(
                    async (title: string): Promise<string> => await submitPostAt("2026-04-21T08:00:00Z", title, "Body"),
                ),
            );
            await writeHarnessHighlights(
                others.map((otherId: string): HarnessHighlight => ({ postId: asPostId(otherId) })),
            );
            vi.setSystemTime(new Date("2026-04-21T10:00:00Z"));

            const asked = await world.deliver("/internal/forms/pin", { post: [postId], slot: ["1"], label: ["none"] });
            const confirmed = await world.deliver("/internal/forms/pin", {
                post: [postId],
                slot: ["1"],
                label: ["none"],
                confirmUnpin: [others.at(-1)],
            });

            expect(asked.body).toHaveProperty(
                "showForm.form.description",
                'Pinning this post unpins "F": choose below what to do. Slots 1 and 2 are old.reddit\'s two stickies.',
            );
            expect(confirmed.body).toStrictEqual({ showToast: 'Pinned "AMA" to slot 1.' });
            await expect(highlightIds()).resolves.toStrictEqual([postId, ...others.slice(0, 5)]);
        },
    );
});
