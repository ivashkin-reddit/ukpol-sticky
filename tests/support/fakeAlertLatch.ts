import { vi } from "vitest";
import type { Mock } from "vitest";
import type { AlertLatch } from "../../src/notifications/index.js";

export interface FakeAlertLatch {
    readonly latch: AlertLatch;
    readonly claim: Mock<AlertLatch["claim"]>;
    readonly confirm: Mock<AlertLatch["confirm"]>;
    readonly release: Mock<AlertLatch["release"]>;
}

/** An alert latch whose claim succeeds unless a test says otherwise. */
export function createFakeAlertLatch(): FakeAlertLatch {
    const claim = vi.fn<AlertLatch["claim"]>().mockResolvedValue(true);
    const confirm = vi.fn<AlertLatch["confirm"]>().mockResolvedValue(undefined);
    const release = vi.fn<AlertLatch["release"]>().mockResolvedValue(undefined);
    return { latch: { claim, confirm, release }, claim, confirm, release };
}
