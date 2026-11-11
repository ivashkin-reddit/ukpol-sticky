import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ConfigPage, ConfigStore, ConfigurationPorts, ThreadConfig } from "../../src/configuration/index.js";
import type { NotifyModerators } from "../../src/notifications/index.js";
import { createFakeAlertLatch } from "./fakeAlertLatch.js";
import type { FakeAlertLatch } from "./fakeAlertLatch.js";
import type { Writes } from "./writes.js";

export const VALID_CONFIG_PAGE = [
    "name: daily-thread",
    "enabled: true",
    "title: Daily thread",
    "frequency: daily",
    'postTime: "12:30"',
    "sticky: true",
    "maxComments: 200",
    "body: |",
    "  Hello world",
].join("\n");

export interface FakeConfigStore {
    readonly readConfigs: Mock<ConfigStore["readConfigs"]>;
    readonly writeConfigs: Mock<ConfigStore["writeConfigs"]>;
    readonly readAcceptedRevision: Mock<ConfigStore["readAcceptedRevision"]>;
    readonly writeAcceptedRevision: Mock<ConfigStore["writeAcceptedRevision"]>;
    readonly readRejectedRevision: Mock<ConfigStore["readRejectedRevision"]>;
    readonly writeRejectedRevision: Mock<ConfigStore["writeRejectedRevision"]>;
}

export interface FakeConfigurationPorts {
    readonly ports: ConfigurationPorts;
    readonly notifyModerators: Mock<NotifyModerators>;
    readonly page: Readonly<{ read: Mock<ConfigPage["read"]>; install: Mock<ConfigPage["install"]> }>;
    readonly store: FakeConfigStore;
    readonly unreadableAlert: FakeAlertLatch;
    /** Every method that writes, sends or claims, for checking that a use case only reads. */
    readonly writes: Writes;
}

export type FakeConfigurationOptions = Readonly<{
    acceptedRevision?: string;
    pageContent?: string;
    storedConfigs?: readonly ThreadConfig[];
}>;

/** A config store whose revision records read back what was last written, as Redis would. */
function createFakeStore(options: FakeConfigurationOptions): FakeConfigStore {
    const revisions: { accepted: string | undefined; rejected: string | undefined } = {
        accepted: options.acceptedRevision,
        rejected: undefined,
    };
    return {
        readConfigs: vi.fn<ConfigStore["readConfigs"]>().mockResolvedValue(options.storedConfigs),
        writeConfigs: vi.fn<ConfigStore["writeConfigs"]>().mockResolvedValue(undefined),
        readAcceptedRevision: vi
            .fn<ConfigStore["readAcceptedRevision"]>()
            .mockImplementation(async (): Promise<string | undefined> => await Promise.resolve(revisions.accepted)),
        writeAcceptedRevision: vi
            .fn<ConfigStore["writeAcceptedRevision"]>()
            .mockImplementation(async (revisionId: string): Promise<void> => {
                revisions.accepted = revisionId;
                await Promise.resolve();
            }),
        readRejectedRevision: vi
            .fn<ConfigStore["readRejectedRevision"]>()
            .mockImplementation(async (): Promise<string | undefined> => await Promise.resolve(revisions.rejected)),
        writeRejectedRevision: vi
            .fn<ConfigStore["writeRejectedRevision"]>()
            .mockImplementation(async (revisionId: string): Promise<void> => {
                revisions.rejected = revisionId;
                await Promise.resolve();
            }),
    };
}

/**
 * Configuration ports whose every method is a typed mock. The config page reads as revision "rev-2" of
 * `pageContent`; nothing is stored unless `storedConfigs` is given.
 */
export function createFakeConfigurationPorts(options: FakeConfigurationOptions = {}): FakeConfigurationPorts {
    const notifyModerators = vi.fn<NotifyModerators>().mockResolvedValue(undefined);
    const page = {
        read: vi.fn<ConfigPage["read"]>().mockResolvedValue({
            content: options.pageContent ?? VALID_CONFIG_PAGE,
            revisionId: "rev-2",
        }),
        install: vi.fn<ConfigPage["install"]>().mockResolvedValue(undefined),
    };
    const store = createFakeStore(options);
    const unreadableAlert = createFakeAlertLatch();

    return {
        ports: { notifyModerators, page, store, unreadableAlert: unreadableAlert.latch },
        notifyModerators,
        page,
        store,
        unreadableAlert,
        writes: {
            "store.writeConfigs": store.writeConfigs,
            "store.writeAcceptedRevision": store.writeAcceptedRevision,
            "store.writeRejectedRevision": store.writeRejectedRevision,
            "page.install": page.install,
            notifyModerators,
            "unreadableAlert.claim": unreadableAlert.claim,
            "unreadableAlert.confirm": unreadableAlert.confirm,
            "unreadableAlert.release": unreadableAlert.release,
        },
    };
}
