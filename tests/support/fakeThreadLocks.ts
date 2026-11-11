import { vi } from "vitest";
import type { Mock } from "vitest";
import type { ThreadLocks } from "../../src/rotation/index.js";
import { createFakeAlertLatch } from "./fakeAlertLatch.js";
import type { FakeAlertLatch } from "./fakeAlertLatch.js";

// The thread locks and per-thread alert latches of the fake rotation ports.

export type FakeThreadLocks = Readonly<{ tryLock: Mock<ThreadLocks["tryLock"]>; unlock: Mock<ThreadLocks["unlock"]> }>;

/** Thread locks that behave like the real ones: one holder per thread config until it unlocks. */
export function createFakeThreadLocks(): FakeThreadLocks {
    const held = new Set<string>();
    return {
        tryLock: vi.fn<ThreadLocks["tryLock"]>().mockImplementation(async (configName: string): Promise<boolean> => {
            const free = !held.has(configName);
            held.add(configName);
            return await Promise.resolve(free);
        }),
        unlock: vi.fn<ThreadLocks["unlock"]>().mockImplementation(async (configName: string): Promise<void> => {
            held.delete(configName);
            await Promise.resolve();
        }),
    };
}

/** One alert latch per thread config name, created the first time it is asked for. */
export function createFakeThreadFailureAlerts(): (configName: string) => FakeAlertLatch {
    const latches = new Map<string, FakeAlertLatch>();
    return (configName: string): FakeAlertLatch => {
        const existing = latches.get(configName);
        if (existing !== undefined) {
            return existing;
        }

        const created = createFakeAlertLatch();
        latches.set(configName, created);
        return created;
    };
}
