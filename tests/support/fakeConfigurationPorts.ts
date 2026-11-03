import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ConfigPage, ConfigStore, ConfigurationPorts, ThreadConfig } from "../../src/configuration/index.js";
import type { NotifyModerators } from "../../src/notifications/index.js";

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
    readonly claimUnreadableAlert: Mock<ConfigStore["claimUnreadableAlert"]>;
    readonly releaseUnreadableAlert: Mock<ConfigStore["releaseUnreadableAlert"]>;
}

export interface FakeConfigurationPorts {
    readonly ports: ConfigurationPorts;
    readonly notifyModerators: Mock<NotifyModerators>;
    readonly page: Readonly<{ read: Mock<ConfigPage["read"]>; install: Mock<ConfigPage["install"]> }>;
    readonly store: FakeConfigStore;
}

export type FakeConfigurationOptions = Readonly<{
    acceptedRevision?: string;
    pageContent?: string;
    storedConfigs?: readonly ThreadConfig[];
}>;

function createFakeStore(options: FakeConfigurationOptions): FakeConfigStore {
    return {
        readConfigs: vi.fn<ConfigStore["readConfigs"]>().mockResolvedValue(options.storedConfigs),
        writeConfigs: vi.fn<ConfigStore["writeConfigs"]>().mockResolvedValue(undefined),
        readAcceptedRevision: vi.fn<ConfigStore["readAcceptedRevision"]>().mockResolvedValue(options.acceptedRevision),
        writeAcceptedRevision: vi.fn<ConfigStore["writeAcceptedRevision"]>().mockResolvedValue(undefined),
        claimUnreadableAlert: vi.fn<ConfigStore["claimUnreadableAlert"]>().mockResolvedValue(true),
        releaseUnreadableAlert: vi.fn<ConfigStore["releaseUnreadableAlert"]>().mockResolvedValue(undefined),
    };
}

/**
 * Configuration ports whose every method is a typed mock. The config page reads as revision "rev-2" of
 * `pageContent` in subreddit testsub; nothing is stored unless `storedConfigs` is given.
 */
export function createFakeConfigurationPorts(options: FakeConfigurationOptions = {}): FakeConfigurationPorts {
    const notifyModerators = vi.fn<NotifyModerators>().mockResolvedValue(undefined);
    const page = {
        read: vi.fn<ConfigPage["read"]>().mockResolvedValue({
            content: options.pageContent ?? VALID_CONFIG_PAGE,
            revisionId: "rev-2",
            subredditName: "testsub",
        }),
        install: vi.fn<ConfigPage["install"]>().mockResolvedValue(undefined),
    };
    const store = createFakeStore(options);

    return { ports: { notifyModerators, page, store }, notifyModerators, page, store };
}
