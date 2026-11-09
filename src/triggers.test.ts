import { describe, expect, it, vi } from "vitest";
import { createFakeConfigurationPorts } from "../tests/support/fakeConfigurationPorts.js";
import { createFakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import type { FakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import { createFakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { configurationPorts, rotationPorts } from "./composition.js";
import type * as Composition from "./composition.js";
import { applyConfigPageRevision } from "./configuration/index.js";
import type * as Configuration from "./configuration/index.js";
import type { ConfigPageOutcome, ConfigurationPorts } from "./configuration/index.js";
import { forgetDeletedPost, requestEveryThreadRefresh, rotateIfCapReached } from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import { onCommentCreate, onModAction, onPostDelete } from "./triggers.js";
import type { CommentCreateEvent, ModActionEvent, PostDeleteEvent } from "./triggers.js";

vi.mock(import("./composition.js"), (): Partial<typeof Composition> => ({
    configurationPorts: vi.fn<typeof configurationPorts>(),
    rotationPorts: vi.fn<typeof rotationPorts>(),
}));

vi.mock(import("./configuration/index.js"), (): Partial<typeof Configuration> => ({
    applyConfigPageRevision: vi.fn<typeof applyConfigPageRevision>(),
}));

vi.mock(import("./rotation/index.js"), (): Partial<typeof Rotation> => ({
    forgetDeletedPost: vi.fn<typeof forgetDeletedPost>(),
    requestEveryThreadRefresh: vi.fn<typeof requestEveryThreadRefresh>(),
    rotateIfCapReached: vi.fn<typeof rotateIfCapReached>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };
const WIKI_REVISION: ModActionEvent = { action: "wikirevise", moderator: { name: "mod_user" } };

interface Wiring {
    readonly devvit: FakeDevvitContext;
    readonly configuration: ConfigurationPorts;
    readonly rotation: FakeRotationPorts;
}

/** A Devvit context, with the composition root building fake ports from it. */
function wired(): Wiring {
    const devvit = createFakeDevvitContext();
    const configuration = createFakeConfigurationPorts().ports;
    const rotation = createFakeRotationPorts();
    vi.mocked(configurationPorts).mockReturnValue(configuration);
    vi.mocked(rotationPorts).mockReturnValue(rotation.ports);
    return { devvit, configuration, rotation };
}

describe(onModAction, (): void => {
    it("ignores mod actions other than wiki revisions", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await onModAction({ action: "approvelink", moderator: { name: "mod_user" } }, wired().devvit.context);

        expect(vi.mocked(applyConfigPageRevision)).not.toHaveBeenCalled();
    });

    it.for<ModActionEvent>([{ action: "wikirevise" }, { action: "wikirevise", moderator: { name: "" } }])(
        "logs and stops when the revising moderator is missing (%j)",
        TEST_OPTIONS,
        async (event: ModActionEvent): Promise<void> => {
            expect.assertions(2);

            const warnSpy = silenceConsole("warn");
            await onModAction(event, wired().devvit.context);

            expect(warnSpy).toHaveBeenCalledExactlyOnceWith(
                "Ignoring a wiki revision ModAction event without a moderator name.",
            );
            expect(vi.mocked(applyConfigPageRevision)).not.toHaveBeenCalled();
        },
    );

    it(
        "applies the revision with ports built from its context, then requests a refresh once it stored thread configs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { devvit, configuration, rotation } = wired();
            vi.mocked(applyConfigPageRevision).mockResolvedValue("stored");
            await onModAction(WIKI_REVISION, devvit.context);

            expect(vi.mocked(configurationPorts)).toHaveBeenCalledExactlyOnceWith(devvit.context);
            expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledExactlyOnceWith("mod_user", configuration);
            expect(vi.mocked(rotationPorts)).toHaveBeenCalledExactlyOnceWith(devvit.context);
            expect(vi.mocked(requestEveryThreadRefresh)).toHaveBeenCalledExactlyOnceWith(
                rotation.ports,
                "thread configs stored since the last refresh",
            );
        },
    );

    it.for<ConfigPageOutcome>(["rejected", "unavailable", "unchanged"])(
        "requests no refresh when the revision was %s",
        TEST_OPTIONS,
        async (outcome: ConfigPageOutcome): Promise<void> => {
            expect.assertions(1);

            vi.mocked(applyConfigPageRevision).mockResolvedValue(outcome);
            await onModAction(WIKI_REVISION, wired().devvit.context);

            expect(vi.mocked(requestEveryThreadRefresh)).not.toHaveBeenCalled();
        },
    );
});

describe(onCommentCreate, (): void => {
    it.for<CommentCreateEvent>([{}, { post: { id: "" } }])(
        "logs and stops when the event has no post id (%j)",
        TEST_OPTIONS,
        async (event: CommentCreateEvent): Promise<void> => {
            expect.assertions(2);

            const warnSpy = silenceConsole("warn");
            await onCommentCreate(event, wired().devvit.context);

            expect(warnSpy).toHaveBeenCalledExactlyOnceWith("Ignoring a CommentCreate event without a post ID.");
            expect(vi.mocked(rotateIfCapReached)).not.toHaveBeenCalled();
        },
    );

    it("ignores the app's own comments", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit } = wired();
        await onCommentCreate({ author: { name: devvit.context.appSlug }, post: { id: "t3_alpha" } }, devvit.context);

        expect(vi.mocked(rotateIfCapReached)).not.toHaveBeenCalled();
    });

    it("checks the commented post against its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onCommentCreate({ author: { name: "someone" }, post: { id: "t3_alpha" } }, devvit.context);

        expect(vi.mocked(rotateIfCapReached)).toHaveBeenCalledExactlyOnceWith(
            { postId: "t3_alpha", reportedComments: 0 },
            rotation.ports,
        );
    });

    it("passes on the comment count the event reports for the post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onCommentCreate(
            { author: { name: "someone" }, post: { id: "t3_alpha", numComments: 42 } },
            devvit.context,
        );

        expect(vi.mocked(rotateIfCapReached)).toHaveBeenCalledExactlyOnceWith(
            { postId: "t3_alpha", reportedComments: 42 },
            rotation.ports,
        );
    });
});

describe(onPostDelete, (): void => {
    it("forgets a deleted post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onPostDelete({ postId: "t3_alpha" }, devvit.context);

        expect(vi.mocked(forgetDeletedPost)).toHaveBeenCalledExactlyOnceWith("t3_alpha", rotation.ports.livePosts);
    });

    it.for<PostDeleteEvent>([{}, { postId: "" }])(
        "logs and stops when a deleted post has no ID (%j)",
        TEST_OPTIONS,
        async (event: PostDeleteEvent): Promise<void> => {
            expect.assertions(2);

            const warnSpy = silenceConsole("warn");
            await onPostDelete(event, wired().devvit.context);

            expect(warnSpy).toHaveBeenCalledExactlyOnceWith("Ignoring a PostDelete event without a post ID.");
            expect(vi.mocked(forgetDeletedPost)).not.toHaveBeenCalled();
        },
    );
});
