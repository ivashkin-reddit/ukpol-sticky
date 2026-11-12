import type { UiResponse } from "@devvit/web/shared";
import { describe, expect, it, vi } from "vitest";
import { createFakeChangeHistory } from "../tests/support/fakeChangeHistory.js";
import type { FakeChangeHistory } from "../tests/support/fakeChangeHistory.js";
import { freezeTime } from "../tests/support/fakeClock.js";
import { createFakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import { createFakeHighlights, unlabelled } from "../tests/support/fakeHighlights.js";
import type { FakeHighlights } from "../tests/support/fakeHighlights.js";
import { createFakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import { STICKY_CONFIG } from "../tests/support/rotationFixtures.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { highlightsPorts, rotationPorts } from "./composition.js";
import type * as Composition from "./composition.js";
import type { DevvitContext } from "./composition.js";
import type { Highlight, ManagedPostLock } from "./highlights/index.js";
import { identifyCaller } from "./moderators.js";
import type * as Moderators from "./moderators.js";
import type { Caller } from "./moderators.js";
import { layOutPinForm } from "./pinForm.js";
import type { PinView } from "./pinForm.js";
import { onPinForm, onPinMenu } from "./pinToSlot.js";
import type { PinFormEvent } from "./pinToSlot.js";

vi.mock(import("./composition.js"), (): Partial<typeof Composition> => ({
    highlightsPorts: vi.fn<typeof highlightsPorts>(),
    rotationPorts: vi.fn<typeof rotationPorts>(),
}));

vi.mock(import("./moderators.js"), async (importOriginal): Promise<typeof Moderators> => ({
    ...(await importOriginal()),
    identifyCaller: vi.fn<typeof identifyCaller>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const POSTER: Caller = { kind: "moderator", moderator: { username: "mod_user", permissions: ["posts"] } };
const AMA = { id: "t3_ama", title: "Title of t3_ama" };
const FORM: PinFormEvent = { postId: "t3_ama", slot: "2", label: "event", confirmUnpin: undefined };

interface PinWorld {
    readonly context: DevvitContext;
    readonly highlights: FakeHighlights;
    readonly history: FakeChangeHistory;
}

/** A request's context, its caller `caller`, over the highlights `initial`; t3_foreign is another subreddit's post. */
function pinWorld(caller: Caller, initial: readonly Highlight[] = unlabelled("t3_w"), busy = false): PinWorld {
    freezeTime("2026-11-11T22:31:00Z");
    const { context } = createFakeDevvitContext();
    const highlights = createFakeHighlights(initial, ["t3_foreign"]);
    const history = createFakeChangeHistory();
    const managedPostLock: ManagedPostLock = async <Result>(
        _postId: string,
        run: () => Promise<Result>,
    ): Promise<Readonly<{ kind: "busy" }> | Readonly<{ kind: "ran"; result: Result }>> =>
        busy ? { kind: "busy" } : { kind: "ran", result: await run() };
    const rotation = createFakeRotationPorts([STICKY_CONFIG], {
        all: async (): Promise<Readonly<Record<string, string>>> =>
            await Promise.resolve({ "sticky-thread": "t3_live" }),
    });
    vi.mocked(identifyCaller).mockResolvedValue(caller);
    vi.mocked(highlightsPorts).mockReturnValue({
        highlights: highlights.highlights,
        managedPostLock,
        changeHistory: history.store,
    });
    vi.mocked(rotationPorts).mockReturnValue(rotation.ports);
    return { context, highlights, history };
}

function formFor(view: Partial<PinView>): UiResponse {
    return {
        showForm: {
            name: "pinForm",
            form: layOutPinForm({
                post: AMA,
                highlights: {
                    entries: [{ post: { id: "t3_w", title: "Title of t3_w" }, label: undefined }],
                    wouldUnpin: undefined,
                },
                managedBy: undefined,
                notice: undefined,
                ...view,
            }),
        },
    };
}

describe(onPinMenu, (): void => {
    it("refuses a caller who is not a moderator before reading anything", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const warnSpy = silenceConsole("warn");
        const world = pinWorld({ kind: "other", username: "someone" });

        await expect(onPinMenu({ postId: "t3_ama" }, world.context)).resolves.toStrictEqual({
            showToast: "Only moderators of r/testsub can pin with Sticky Manager.",
        });
        expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
            "Refused Pin to slot to u/someone: not a moderator of r/testsub.",
        );
        expect(world.highlights.readPost).not.toHaveBeenCalled();
    });

    it(
        "refuses a moderator without the Everything or Posts permission before reading anything",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const warnSpy = silenceConsole("warn");
            const world = pinWorld({ kind: "moderator", moderator: { username: "wiki_mod", permissions: ["wiki"] } });

            await expect(onPinMenu({ postId: "t3_ama" }, world.context)).resolves.toStrictEqual({
                showToast: "Pinning with Sticky Manager needs the Everything or Posts moderator permission.",
            });
            expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
                "Refused Pin to slot to u/wiki_mod: needs the Everything or Posts permission.",
            );
            expect(world.highlights.readPost).not.toHaveBeenCalled();
        },
    );

    it.for([undefined, "t3_foreign"])(
        "refuses the post %s, which is not this subreddit's",
        TEST_OPTIONS,
        async (postId: string | undefined): Promise<void> => {
            expect.assertions(1);

            const world = pinWorld(POSTER);

            await expect(onPinMenu({ postId }, world.context)).resolves.toStrictEqual({
                showToast: "That post is not in r/testsub.",
            });
        },
    );

    it("shows the pin form for a post of this subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const world = pinWorld(POSTER);

        await expect(onPinMenu({ postId: "t3_ama" }, world.context)).resolves.toStrictEqual(formFor({}));
    });

    it("notes a managed thread's live post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const world = pinWorld(POSTER);

        await expect(onPinMenu({ postId: "t3_live" }, world.context)).resolves.toStrictEqual(
            formFor({
                post: { id: "t3_live", title: "Title of t3_live" },
                managedBy: { configName: "sticky-thread", pin: { kind: "keepSlot" } },
            }),
        );
    });
});

describe(onPinForm, (): void => {
    it("pins the post, logs it, records it and says so", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = silenceConsole("log");
        const world = pinWorld(POSTER);

        await expect(onPinForm(FORM, world.context)).resolves.toStrictEqual({
            showToast: 'Pinned "Title of t3_ama" to slot 2.',
        });
        expect(logSpy).toHaveBeenCalledExactlyOnceWith("u/mod_user pinned post t3_ama to slot 2 (Event).");
        expect(world.history.add).toHaveBeenCalledExactlyOnceWith({
            kind: "pin",
            at: new Date("2026-11-11T22:31:00Z"),
            moderator: "mod_user",
            action: "pinned",
            post: AMA,
            fromSlot: undefined,
            toSlot: 2,
            label: "Event",
            unpinned: undefined,
        });
    });

    it(
        "says nothing changed, recording nothing, for a post already in place",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const world = pinWorld(POSTER, [...unlabelled("t3_w"), { postId: "t3_ama", label: "event" }]);

            await expect(onPinForm(FORM, world.context)).resolves.toStrictEqual({ showToast: "Nothing to change." });
            expect(world.history.add).not.toHaveBeenCalled();
        },
    );

    it.for<Partial<PinFormEvent>>([
        { slot: "7" },
        { slot: "02" },
        { slot: undefined },
        { label: "pinned" },
        { label: undefined },
    ])(
        "shows the form again, pinning nothing, for the choice %o, which the form never offers",
        TEST_OPTIONS,
        async (choice: Partial<PinFormEvent>): Promise<void> => {
            expect.assertions(2);

            const world = pinWorld(POSTER);

            await expect(onPinForm({ ...FORM, ...choice }, world.context)).resolves.toStrictEqual(formFor({}));
            expect(world.highlights.pin).not.toHaveBeenCalled();
        },
    );

    it("unpins for Not pinned and None", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const world = pinWorld(POSTER, unlabelled("t3_ama"));

        await expect(onPinForm({ ...FORM, slot: "none", label: "none" }, world.context)).resolves.toStrictEqual({
            showToast: 'Unpinned "Title of t3_ama".',
        });
    });

    it(
        "shows the form again with the post Reddit would unpin when all six are taken",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const six = unlabelled("t3_a", "t3_b", "t3_c", "t3_d", "t3_e", "t3_f");
            const world = pinWorld(POSTER, six);
            const response = await onPinForm(FORM, world.context);

            expect(response.showForm?.form.description).toBe(
                'Pinning this post unpins "Title of t3_f": confirm below to go ahead. Slots 1 and 2 are old.reddit\'s two stickies.',
            );
            expect(world.highlights.pin).not.toHaveBeenCalled();
        },
    );

    it("says the thread is being refreshed while its lock is held", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const world = pinWorld(POSTER, unlabelled("t3_w"), true);

        await expect(onPinForm(FORM, world.context)).resolves.toStrictEqual({
            showToast: "That thread is being refreshed. Try again in a minute.",
        });
    });

    it("refuses a post of another subreddit", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const world = pinWorld(POSTER);

        await expect(onPinForm({ ...FORM, postId: "t3_foreign" }, world.context)).resolves.toStrictEqual({
            showToast: "That post is not in r/testsub.",
        });
    });
});
