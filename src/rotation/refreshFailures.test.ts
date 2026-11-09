import { describe, expect, it, vi } from "vitest";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { PUBLISH_ERROR, refreshFailureAlert, threadFailureAlert } from "../../tests/support/rotationFixtures.js";
import { UnreadableConfigError } from "../configuration/index.js";
import { alertingOnRefreshFailure, alertingOnThreadFailure } from "./refreshFailures.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

function failingStep(error: unknown): () => Promise<void> {
    return vi.fn<() => Promise<void>>().mockRejectedValue(error);
}

describe(alertingOnThreadFailure, (): void => {
    it("sends nothing when the step succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        await alertingOnThreadFailure(
            fakes.ports,
            "sticky-thread",
            vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
        );

        expect(fakes.threadFailureAlert("sticky-thread").claim).not.toHaveBeenCalled();
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it(
        "claims the thread config's alert, alerts moderators, confirms it was sent and passes the failure on",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeRotationPorts();

            await expect(
                alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep(PUBLISH_ERROR)),
            ).rejects.toBe(PUBLISH_ERROR);
            expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(
                threadFailureAlert("sticky-thread", "Reddit is down"),
            );
            expect(fakes.threadFailureAlert("sticky-thread").confirm).toHaveBeenCalledAfter(fakes.notifyModerators);
            expect(fakes.refreshFailureAlert.claim).not.toHaveBeenCalled();
        },
    );

    it(
        "keeps the failure, and leaves the claim to lapse, when the sent alert cannot be confirmed",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts();
            const confirmError = new Error("redis unavailable");
            fakes.threadFailureAlert("sticky-thread").confirm.mockRejectedValue(confirmError);
            const running = alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep(PUBLISH_ERROR));

            await expect(running).rejects.toThrow(
                new Error(
                    "Moderators were alerted that a refresh failed (Reddit is down), but the alert could not be recorded as sent",
                ),
            );
            await expect(running).rejects.toHaveProperty("cause", confirmError);
            expect(fakes.threadFailureAlert("sticky-thread").release).not.toHaveBeenCalled();
        },
    );

    it("sends nothing while an earlier alert about the thread config stands", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        fakes.threadFailureAlert("sticky-thread").claim.mockResolvedValue(false);

        await expect(alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep(PUBLISH_ERROR))).rejects.toBe(
            PUBLISH_ERROR,
        );
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it("leaves unreadable thread configs to configuration's own alert", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");

        await expect(alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep(unreadable))).rejects.toBe(
            unreadable,
        );
        expect(fakes.threadFailureAlert("sticky-thread").claim).not.toHaveBeenCalled();
    });

    it(
        "releases the claim and reports both failures when the alert cannot be sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(4);

            const fakes = createFakeRotationPorts();
            const sendError = new Error("modmail unavailable");
            fakes.notifyModerators.mockRejectedValue(sendError);
            const running = alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep(PUBLISH_ERROR));

            await expect(running).rejects.toThrow(
                new Error("Could not alert moderators that a refresh failed (Reddit is down)"),
            );
            await expect(running).rejects.toHaveProperty("cause", sendError);
            expect(fakes.threadFailureAlert("sticky-thread").release).toHaveBeenCalledExactlyOnceWith();
            expect(fakes.threadFailureAlert("sticky-thread").confirm).not.toHaveBeenCalled();
        },
    );

    it("describes a failure that is not an Error by its text", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();

        await expect(alertingOnThreadFailure(fakes.ports, "sticky-thread", failingStep("timeout"))).rejects.toBe(
            "timeout",
        );
        expect(fakes.notifyModerators.mock.lastCall?.[0].bodyMarkdown.endsWith("Details: timeout")).toBe(true);
    });
});

describe(alertingOnRefreshFailure, (): void => {
    it("alerts moderators once, under the general alert's latch", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const fakes = createFakeRotationPorts();
        const schedulerError = new Error("scheduler unavailable");

        await expect(alertingOnRefreshFailure(fakes.ports, failingStep(schedulerError))).rejects.toBe(schedulerError);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith(refreshFailureAlert("scheduler unavailable"));
        expect(fakes.refreshFailureAlert.confirm).toHaveBeenCalledAfter(fakes.notifyModerators);
    });
});
