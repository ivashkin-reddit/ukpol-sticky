import type { ThreadConfig } from "../../src/configuration/index.js";
import type { Handover, LivePosts } from "../../src/rotation/index.js";
import { createFakeRotationPorts } from "./fakeRotationPorts.js";
import type { FakeRotationPorts } from "./fakeRotationPorts.js";

/** The live posts and handovers an in-memory store holds, for tests to inspect. */
export interface LivePostStore {
    readonly livePostIds: Map<string, string>;
    readonly handovers: Map<string, Handover>;
}

type StoredLivePosts = Omit<LivePosts, "forgetCommentCap" | "getCommentCap" | "storeCommentCap">;

/** Live post records and handovers kept in maps, as Redis keeps them: what is written is read back. */
function createInMemoryLivePosts(
    livePostIds: Readonly<Record<string, string>>,
): Readonly<{ store: LivePostStore; livePosts: StoredLivePosts }> {
    const store: LivePostStore = { livePostIds: new Map(Object.entries(livePostIds)), handovers: new Map() };
    const read = async <Value>(value: Value): Promise<Value> => await Promise.resolve(value);
    return {
        store,
        livePosts: {
            all: async (): Promise<Record<string, string>> => await read(Object.fromEntries(store.livePostIds)),
            get: async (configName: string): Promise<string | undefined> =>
                await read(store.livePostIds.get(configName)),
            configNames: async (): Promise<string[]> =>
                await read([...new Set([...store.livePostIds.keys(), ...store.handovers.keys()])]),
            set: async (configName: string, postId: string): Promise<void> => {
                await read(store.livePostIds.set(configName, postId));
            },
            forget: async (configNames: readonly string[]): Promise<void> => {
                for (const configName of configNames) {
                    store.livePostIds.delete(configName);
                    store.handovers.delete(configName);
                }

                await read(undefined);
            },
            handovers: async (): Promise<Record<string, Handover>> => await read(Object.fromEntries(store.handovers)),
            saveHandover: async (configName: string, handover: Handover): Promise<void> => {
                await read(store.handovers.set(configName, handover));
            },
            forgetHandover: async (configName: string): Promise<void> => {
                await read(store.handovers.delete(configName));
            },
        },
    };
}

/**
 * Rotation ports over `configs` whose live posts and handovers are kept in memory, starting from `livePostIds`.
 * Their methods are still mocks, so a test can fail one step; comment caps stay plain mocks.
 */
export function createStoredRotationPorts(
    configs: readonly ThreadConfig[],
    livePostIds: Readonly<Record<string, string>>,
): Readonly<{ fakes: FakeRotationPorts; store: LivePostStore }> {
    const { store, livePosts } = createInMemoryLivePosts(livePostIds);
    return { fakes: createFakeRotationPorts(configs, livePosts), store };
}
