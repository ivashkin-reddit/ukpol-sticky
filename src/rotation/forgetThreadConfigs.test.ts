import { describe, expect, it } from "vitest";
import { createFakeRotationPorts, PENDING_REFRESH_AT } from "../../tests/support/fakeRotationPorts.js";
import { DISABLED_CONFIG, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { forgetRemovedThreadConfigs, forgetThreadConfigs } from "./forgetThreadConfigs.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(forgetThreadConfigs, (): void => {
    it(
        "forgets the thread configs' live posts, applied versions, status, alert latches and pending refreshes",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(5);

            const fakes = createFakeRotationPorts();
            fakes.livePosts.all.mockResolvedValue({ alpha: "t3_alpha", beta: "t3_beta" });

            await forgetThreadConfigs(["alpha", "gamma"], fakes.ports);

            expect(fakes.livePosts.forget).toHaveBeenCalledExactlyOnceWith(["alpha", "gamma"], ["t3_alpha"]);
            expect(fakes.appliedThreadConfigs.forget).toHaveBeenCalledExactlyOnceWith(["alpha", "gamma"]);
            expect(fakes.refreshStatus.forget).toHaveBeenCalledExactlyOnceWith(["alpha", "gamma"]);
            expect(fakes.threadFailureAlert("gamma").release).toHaveBeenCalledExactlyOnceWith();
            expect(fakes.refreshJobs.cancelFor.mock.calls).toStrictEqual([["alpha"], ["gamma"]]);
        },
    );

    it("does nothing for no thread configs", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        const fakes = createFakeRotationPorts();
        await forgetThreadConfigs([], fakes.ports);

        expect(fakes.livePosts.forget).not.toHaveBeenCalled();
    });
});

describe(forgetRemovedThreadConfigs, (): void => {
    it(
        "forgets every thread config recorded but no longer in force, and logs which",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const logSpy = silenceConsole("log");
            const fakes = createFakeRotationPorts([STICKY_CONFIG, DISABLED_CONFIG]);
            fakes.livePosts.configNames.mockResolvedValue(["sticky-thread", "stale-thread"]);
            fakes.refreshJobs.pending.mockResolvedValue([
                { configName: "disabled-thread", runAt: PENDING_REFRESH_AT },
                { configName: "sticky-thread", runAt: PENDING_REFRESH_AT },
                { configName: undefined, runAt: PENDING_REFRESH_AT },
            ]);

            await forgetRemovedThreadConfigs(fakes.ports);

            expect(fakes.appliedThreadConfigs.forget).toHaveBeenCalledExactlyOnceWith([
                "stale-thread",
                "disabled-thread",
            ]);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Forgetting removed or disabled thread configs: stale-thread, disabled-thread.",
            );
        },
    );

    it(
        "reads the thread configs in force after the recorded names, so one added in between is kept",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            const fakes = createFakeRotationPorts([STICKY_CONFIG]);

            await forgetRemovedThreadConfigs(fakes.ports);

            expect(fakes.threadConfigs).toHaveBeenCalledAfter(fakes.refreshJobs.pending);
            expect(fakes.appliedThreadConfigs.forget).not.toHaveBeenCalled();
        },
    );
});
