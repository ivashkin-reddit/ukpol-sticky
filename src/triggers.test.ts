import { describe, expect, it, vi } from "vitest";
import { createConfigPageFakes } from "../tests/support/fakeConfigPageContext.js";
import { createFakeRotationContext } from "../tests/support/fakeRotationContext.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import type * as Configuration from "./configuration/index.js";
import type { ConfigPageOutcome, ConfigPageRevisionContext } from "./configuration/index.js";
import {
    forgetDeletedPost,
    refreshAllThreads,
    requestRefresh,
    rotateIfCapReached,
    scheduleNextRefresh,
} from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import type { RefreshJobContext, RotationContext } from "./rotation/index.js";
import { onAppInstall, onAppUpgrade, onCommentCreate, onModAction, onPostDelete, onRefreshJob } from "./triggers.js";
import type { CommentCreateEvent, ModActionEvent } from "./triggers.js";

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
const APP_SLUG = "ukpol-sticky";
const WIKI_REVISION: ModActionEvent = { action: "wikirevise", moderator: { name: "mod_user" } };

function modActionContext(): ConfigPageRevisionContext & RefreshJobContext {
    return { ...createConfigPageFakes().context, scheduler: createFakeRotationContext().scheduler };
}

function commentContext(): RotationContext & Readonly<{ appSlug: string }> {
    return { ...createFakeRotationContext().context, appSlug: APP_SLUG };
}

describe(onModAction, (): void => {
    it("ignores mod actions other than wiki revisions", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await onModAction({ action: "approvelink", moderator: { name: "mod_user" } }, modActionContext());

        expect(vi.mocked(applyConfigPageRevision)).not.toHaveBeenCalled();
    });

    it.for<ModActionEvent>([{ action: "wikirevise" }, { action: "wikirevise", moderator: { name: "" } }])(
        "logs and stops when the revising moderator is missing (%j)",
        TEST_OPTIONS,
        async (event: ModActionEvent): Promise<void> => {
            expect.assertions(2);

            const errorSpy = silenceConsole("error");
            await onModAction(event, modActionContext());

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("Moderator name is missing in the event.");
            expect(vi.mocked(applyConfigPageRevision)).not.toHaveBeenCalled();
        },
    );

    it(
        "applies the revision and requests a refresh when it stored new thread configs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const context = modActionContext();
            vi.mocked(applyConfigPageRevision).mockResolvedValue("stored");
            await onModAction(WIKI_REVISION, context);

            expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledExactlyOnceWith("mod_user", context);
            expect(vi.mocked(requestRefresh)).toHaveBeenCalledExactlyOnceWith(context);
        },
    );

    it.for<ConfigPageOutcome>(["rejected", "unavailable", "unchanged"])(
        "requests no refresh when the revision was %s",
        TEST_OPTIONS,
        async (outcome: ConfigPageOutcome): Promise<void> => {
            expect.assertions(1);

            vi.mocked(applyConfigPageRevision).mockResolvedValue(outcome);
            await onModAction(WIKI_REVISION, modActionContext());

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
            await onCommentCreate(event, commentContext());

            expect(errorSpy).toHaveBeenCalledExactlyOnceWith("CommentCreate event does not contain a post ID.");
            expect(vi.mocked(rotateIfCapReached)).not.toHaveBeenCalled();
        },
    );

    it("ignores the app's own comments", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        await onCommentCreate({ author: { name: APP_SLUG }, post: { id: "t3_alpha" } }, commentContext());

        expect(vi.mocked(rotateIfCapReached)).not.toHaveBeenCalled();
    });

    it("checks the commented post against its comment cap", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const context = commentContext();
        await onCommentCreate({ author: { name: "someone" }, post: { id: "t3_alpha" } }, context);

        expect(vi.mocked(rotateIfCapReached)).toHaveBeenCalledExactlyOnceWith("t3_alpha", context);
    });
});

describe("lifecycle and job triggers", (): void => {
    it("forgets a deleted post", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { context } = createFakeRotationContext();
        await onPostDelete({ postId: "t3_alpha" }, context);

        expect(vi.mocked(forgetDeletedPost)).toHaveBeenCalledExactlyOnceWith("t3_alpha", context);
    });

    it("installs the config page on install", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const context = {
            reddit: {
                getCurrentSubredditName: vi.fn<() => Promise<string>>(),
                updateWikiPage: vi.fn<Configuration.ConfigPageInstallContext["reddit"]["updateWikiPage"]>(),
                updateWikiPageSettings:
                    vi.fn<Configuration.ConfigPageInstallContext["reddit"]["updateWikiPageSettings"]>(),
            },
        };
        await onAppInstall({}, context);

        expect(vi.mocked(installConfigPage)).toHaveBeenCalledExactlyOnceWith(context);
    });

    it("schedules the next refresh on upgrade", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { context } = createFakeRotationContext();
        await onAppUpgrade({}, context);

        expect(vi.mocked(scheduleNextRefresh)).toHaveBeenCalledExactlyOnceWith(context);
    });

    it("refreshes every thread when the refresh job runs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { context } = createFakeRotationContext();
        await onRefreshJob({}, context);

        expect(vi.mocked(refreshAllThreads)).toHaveBeenCalledExactlyOnceWith(context);
    });
});
