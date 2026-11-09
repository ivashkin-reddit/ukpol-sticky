import { describe, expect, it, vi } from "vitest";
import { createFakeConfigurationPorts } from "../tests/support/fakeConfigurationPorts.js";
import { createFakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import type { FakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import { createFakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import { configurationPorts, rotationPorts } from "./composition.js";
import type * as Composition from "./composition.js";
import { applyConfigPageRevision, installConfigPage } from "./configuration/index.js";
import type * as Configuration from "./configuration/index.js";
import type { ConfigurationPorts } from "./configuration/index.js";
import {
    checkRefreshes,
    migrateRefreshRecords,
    refreshThreadConfig,
    requestEveryThreadRefresh,
    scheduleEveryThreadRefresh,
    startRefreshCheck,
} from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import { onAppInstall, onAppUpgrade, onRefreshCheck, onRefreshJob } from "./triggers.js";

// The triggers and jobs that keep refreshes going: install, upgrade, each refresh job and the hourly check.

vi.mock(import("./composition.js"), (): Partial<typeof Composition> => ({
    configurationPorts: vi.fn<typeof configurationPorts>(),
    rotationPorts: vi.fn<typeof rotationPorts>(),
}));

vi.mock(import("./configuration/index.js"), (): Partial<typeof Configuration> => ({
    applyConfigPageRevision: vi.fn<typeof applyConfigPageRevision>(),
    installConfigPage: vi.fn<typeof installConfigPage>(),
}));

vi.mock(import("./rotation/index.js"), (): Partial<typeof Rotation> => ({
    checkRefreshes: vi.fn<typeof checkRefreshes>(),
    migrateRefreshRecords: vi.fn<typeof migrateRefreshRecords>(),
    refreshThreadConfig: vi.fn<typeof refreshThreadConfig>(),
    requestEveryThreadRefresh: vi.fn<typeof requestEveryThreadRefresh>(),
    scheduleEveryThreadRefresh: vi.fn<typeof scheduleEveryThreadRefresh>(),
    startRefreshCheck: vi.fn<typeof startRefreshCheck>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

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

describe("install and upgrade", (): void => {
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
        "starts the refresh check, migrates the old records, then schedules each thread config's next refresh, on upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const { devvit, rotation } = wired();
            await onAppUpgrade({}, devvit.context);

            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledExactlyOnceWith(rotation.ports.refreshJobs);
            expect(vi.mocked(migrateRefreshRecords)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
            expect(vi.mocked(scheduleEveryThreadRefresh)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
            expect(vi.mocked(startRefreshCheck)).toHaveBeenCalledBefore(vi.mocked(migrateRefreshRecords));
            // Migrated first, or every thread config would read as unapplied and be refreshed at once.
            expect(vi.mocked(migrateRefreshRecords)).toHaveBeenCalledBefore(vi.mocked(scheduleEveryThreadRefresh));
        },
    );

    it("applies the config page last, on upgrade", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const { devvit, configuration } = wired();
        await onAppUpgrade({}, devvit.context);

        expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledExactlyOnceWith(undefined, configuration);
        // A refresh the page requests must come after scheduleEveryThreadRefresh, or a rotation time replaces it.
        expect(vi.mocked(scheduleEveryThreadRefresh)).toHaveBeenCalledBefore(vi.mocked(applyConfigPageRevision));
    });

    it(
        "requests a refresh when the upgrade stores thread configs no trigger applied",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { devvit, rotation } = wired();
            vi.mocked(applyConfigPageRevision).mockResolvedValue("stored");
            await onAppUpgrade({}, devvit.context);

            expect(vi.mocked(requestEveryThreadRefresh)).toHaveBeenCalledExactlyOnceWith(
                rotation.ports,
                "thread configs stored since the last refresh",
            );
            expect(vi.mocked(scheduleEveryThreadRefresh)).toHaveBeenCalledBefore(vi.mocked(requestEveryThreadRefresh));
        },
    );
});

describe("refresh jobs and the refresh check", (): void => {
    it("refreshes the thread config a refresh job names", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { devvit, rotation } = wired();
        await onRefreshJob({ configName: "daily-thread" }, devvit.context);

        expect(vi.mocked(refreshThreadConfig)).toHaveBeenCalledExactlyOnceWith("daily-thread", rotation.ports);
    });

    it(
        "requests a refresh of every thread config for a refresh job from before the upgrade",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const { devvit, rotation } = wired();
            await onRefreshJob({}, devvit.context);

            expect(vi.mocked(requestEveryThreadRefresh)).toHaveBeenCalledExactlyOnceWith(
                rotation.ports,
                "a refresh scheduled before the upgrade",
            );
            expect(vi.mocked(refreshThreadConfig)).not.toHaveBeenCalled();
        },
    );

    it(
        "checks each thread config's refresh, then applies a config page revision no trigger applied, when the refresh check runs",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const { devvit, configuration, rotation } = wired();
            await onRefreshCheck({}, devvit.context);

            expect(vi.mocked(applyConfigPageRevision)).toHaveBeenCalledExactlyOnceWith(undefined, configuration);
            expect(vi.mocked(checkRefreshes)).toHaveBeenCalledExactlyOnceWith(rotation.ports);
            expect(vi.mocked(checkRefreshes)).toHaveBeenCalledBefore(vi.mocked(applyConfigPageRevision));
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

            expect(vi.mocked(requestEveryThreadRefresh)).toHaveBeenCalledExactlyOnceWith(
                rotation.ports,
                "thread configs stored since the last refresh",
            );
        },
    );
});
