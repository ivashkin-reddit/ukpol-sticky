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
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
} from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import { onAppInstall, onAppUpgrade, onCommentCreate, onModAction, onPostDelete, onRefreshJob } from "./triggers.js";
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
    forgetDeletedPost: vi.fn<typeof forgetDeletedPost>(),
    refreshAllThreads: vi.fn<typeof refreshAllThreads>(),
    requestRefresh: vi.fn<typeof requestRefresh>(),
    rotateIfCapReached: vi.fn<typeof rotateIfCapReached>(),
    scheduleNextRefresh: vi.fn<typeof scheduleNextRefresh>(),
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

            const errorSpy = silenceConsole("error");
            await onModAction(event, wired().devvit.context);

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("Moderator name is missing in the event.");
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
            expect(vi.mocked(requestRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports.refreshJobs);
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

            const errorSpy = silenceConsole("error");
            await onCommentCreate(event, wired().devvit.context);

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("CommentCreate event does not contain a post ID.");
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

        expect(vi.mocked(rotateIfCapReached)).toHaveBeenCalledExactlyOnceWith("t3_alpha", rotation.ports);
    });
});

describe("lifecycle and job triggers", (): void => {
    it("forgets a deleted post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onPostDelete({ postId: "t3_alpha" }, devvit.context);

        expect(vi.mocked(forgetDeletedPost)).toHaveBeenCalledExactlyOnceWith("t3_alpha", rotation.ports.livePosts);
    });

    it("installs the config page on install", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, configuration } = wired();
        await onAppInstall({}, devvit.context);

        expect(vi.mocked(installConfigPage)).toHaveBeenCalledExactlyOnceWith(configuration.page);
    });

    it("schedules the next refresh on upgrade", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onAppUpgrade({}, devvit.context);

        expect(vi.mocked(scheduleNextRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
    });

    it("refreshes every thread when the refresh job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onRefreshJob({}, devvit.context);

        expect(vi.mocked(refreshAllThreads)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
    });
});
