import { describe, expect, vi } from "vitest";
import { rotationPorts } from "../src/composition.js";
import type { ThreadLocks } from "../src/rotation/index.js";
import { HARNESS_CONTEXT } from "./support/devvitHarness.js";
import { it as devvitIt } from "./support/devvitTest.js";
import { freezeTime } from "./support/fakeClock.js";

// Each test gets a fresh in-memory Devvit world; five seconds covers that setup on a slow machine.
const TEST_OPTIONS = { timeout: 5000 };

describe("thread locks on Devvit's Redis", (): void => {
    devvitIt("admit one holder per thread config until it unlocks", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const { threadLocks } = rotationPorts(HARNESS_CONTEXT);
        const first = await threadLocks.tryLock("daily-thread");
        const second = await threadLocks.tryLock("daily-thread");
        const otherThread = await threadLocks.tryLock("weekly-thread");
        await threadLocks.unlock("daily-thread");
        const afterUnlock = await threadLocks.tryLock("daily-thread");

        expect([first, second, otherThread, afterUnlock]).toStrictEqual([true, false, true, true]);
    });

    devvitIt("free a lock whose holder never unlocked once it expires", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        freezeTime("2026-04-21T10:00:00Z");
        const { threadLocks } = rotationPorts(HARNESS_CONTEXT);
        await threadLocks.tryLock("daily-thread");
        vi.setSystemTime(new Date("2026-04-21T10:01:59Z"));
        const beforeExpiry = await threadLocks.tryLock("daily-thread");
        vi.setSystemTime(new Date("2026-04-21T10:02:01Z"));
        const afterExpiry = await threadLocks.tryLock("daily-thread");

        expect([beforeExpiry, afterExpiry]).toStrictEqual([false, true]);
    });

    devvitIt(
        "keep a later holder's lock when an earlier holder outlived its own and then unlocks",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            freezeTime("2026-04-21T10:00:00Z");
            vi.spyOn(console, "error").mockImplementation((): undefined => undefined);
            // Each invocation builds its own ports, as each Devvit handler does.
            const [first, second, third] = [1, 2, 3].map((): ThreadLocks => rotationPorts(HARNESS_CONTEXT).threadLocks);
            await first?.tryLock("daily-thread");
            vi.setSystemTime(new Date("2026-04-21T10:02:01Z"));
            const secondHolds = await second?.tryLock("daily-thread");
            await first?.unlock("daily-thread");
            const thirdHolds = await third?.tryLock("daily-thread");

            expect(secondHolds).toBe(true);
            expect(thirdHolds).toBe(false);
        },
    );
});
