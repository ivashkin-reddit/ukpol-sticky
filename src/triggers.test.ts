import { describe, expect, it, vi } from "vitest";
import { createFakeConfigurationPorts } from "../tests/support/fakeConfigurationPorts.js";
import { createFakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import type { FakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import { createFakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { configurationPorts, rotationPorts } from "./composition.js";
import type * as Composition from "./composition.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import type * as Configuration from "./configuration/index.js";
import type { ConfigPageOutcome, ConfigurationPorts } from "./configuration/index.js";
import {
    ensureRefreshPending,
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
    startRefreshCheck,
} from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import {
    onAppInstall,
    onAppUpgrade,
    onCommentCreate,
    onModAction,
    onPostDelete,
    onRefreshCheck,
    onRefreshJob,
} from "./triggers.js";
import type { CommentCreateEvent, ModActionEvent } from "./triggers.js";

vi.mock(import("./composition.js"), (): Partial<typeof Composition> => ({
    configurationPorts: vi.fn<typeof configurationPorts>(),
    rotationPorts: vi.fn<typeof rotationPorts>(),
}));

vi.mock(import("./configuration/index.js"), (): Partial<typeof Configuration> => ({
    applyConfigPageRevision: vi.fn<typeof applyConfigPageRevision>(),
    installConfigPage: vi.fn<typeof installConfigPage>(),
}));

vi.mock(import("./rotation/index.js"), (): Partial<typeof Rotation> => ({
    ensureRefreshPending: vi.fn<typeof ensureRefreshPending>(),
    forgetDeletedPost: vi.fn<typeof forgetDeletedPost>(),
    refreshAllThreads: vi.fn<typeof refreshAllThreads>(),
    requestRefresh: vi.fn<typeof requestRefresh>(),
    rotateIfCapReached: vi.fn<typeof rotateIfCapReached>(),
    scheduleNextRefresh: vi.fn<typeof scheduleNextRefresh>(),
    startRefreshCheck: vi.fn<typeof startRefreshCheck>(),
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
            expect(vi.mocked(requestRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
        },
    );

    it.for<ConfigPageOutcome>(["rejected", "unavailable", "unchanged"])(
        "requests no refresh when the revision was %s",
        TEST_OPTIONS,
        async (outcome: ConfigPageOutcome): Promise<void> => {
            expect.assertions(1);

            vi.mocked(applyConfigPageRevision).mockResolvedValue(outcome);
            await onModAction(WIKI_REVISION, wired().devvit.context);

            expect(vi.mocked(requestRefresh)).not.toHaveBeenCalled();
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

describe("lifecycle and job triggers", (): void => {
    it("forgets a deleted post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onPostDelete({ postId: "t3_alpha" }, devvit.context);

        expect(vi.mocked(forgetDeletedPost)).toHaveBeenCalledExactlyOnceWith("t3_alpha", rotation.ports.livePosts);
    });

    it(
        "starts the refresh check, installs the config page, then applies it, on install",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const { devvit, configuration, rotation } = wired();
            await onAppInstall({}, devvit.context);

            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledExactlyOnceWith(rotation.ports.refreshJobs);
            expect(vi.mocked(installConfigPage)).toHaveBeenCalledExactlyOnceWith(configuration.page);
            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledBefore(vi.mocked(installConfigPage));
            // A reinstall finds the moderators' thread configs on the page: they apply now, not at the next save.
            expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledAfter(vi.mocked(installConfigPage));
        },
    );

    it(
        "starts the refresh check, then schedules the next refresh, on upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { devvit, rotation } = wired();
            await onAppUpgrade({}, devvit.context);

            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledExactlyOnceWith(rotation.ports.refreshJobs);
            expect(vi.mocked(scheduleNextRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledBefore(vi.mocked(scheduleNextRefresh));
        },
    );

    it("refreshes every thread when the refresh job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onRefreshJob({}, devvit.context);

        expect(vi.mocked(refreshAllThreads)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
    });

    it(
        "makes sure a refresh is pending, then applies a config page revision no trigger applied, when the refresh check runs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { devvit, configuration, rotation } = wired();
            await onRefreshCheck({}, devvit.context);

            expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledExactlyOnceWith(undefined, configuration);
            expect(vi.mocked(ensureRefreshPending)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
            expect(vi.mocked(ensureRefreshPending)).toHaveBeenCalledBefore(vi.mocked(applyConfigPageRevision));
        },
    );

    it(
        "requests a refresh when the refresh check stores thread configs no trigger applied",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            const { devvit, rotation } = wired();
            vi.mocked(applyConfigPageRevision).mockResolvedValue("stored");
            await onRefreshCheck({}, devvit.context);

            expect(vi.mocked(requestRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
        },
    );
});
