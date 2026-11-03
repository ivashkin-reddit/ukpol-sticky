import { describe, expect, it, vi } from "vitest";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { refreshThread } from "./threadRefresh.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(refreshThread, (): void => {
    it(
        "skips a thread config another invocation is refreshing, without reading it",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG]);
            fakes.threadLocks.tryLock.mockResolvedValue(false);

            await expect(refreshThread(STICKY_CONFIG, fakes.ports)).resolves.toBe("skipped");
            expect(fakes.livePosts.get).not.toHaveBeenCalled();
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Skipping thread config sticky-thread: another refresh of it is under way.",
            );
        },
    );

    it("releases the thread config's lock when its refresh fails", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        vi.spyOn(console, "log").mockImplementation((): undefined => undefined);
        const fakes = createFakeRotationPorts([STICKY_CONFIG]);
        const publishError = new Error("Reddit is down");
        fakes.posts.publish.mockRejectedValue(publishError);

        await expect(refreshThread(STICKY_CONFIG, fakes.ports)).rejects.toBe(publishError);
        expect(fakes.threadLocks.unlock).toHaveBeenCalledExactlyOnceWith("sticky-thread");
    });
});
