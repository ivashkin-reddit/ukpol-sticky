import { describe, expect, it, vi } from "vitest";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { UnreadableConfigError } from "../configuration/index.js";
import { alertingOnFailure } from "./refreshFailures.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const STEP_ERROR = new Error("Reddit is down");

function failingStep(error: unknown): () => Promise<void> {
    return vi.fn<() => Promise<void>>().mockRejectedValue(error);
}

describe(alertingOnFailure, (): void => {
    it("sends nothing when the step succeeds", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        await alertingOnFailure(fakes.ports, vi.fn<() => Promise<void>>().mockResolvedValue(undefined));

        expect(fakes.refreshFailureAlert.claim).not.toHaveBeenCalled();
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it("claims the alert, alerts moderators and passes the failure on", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();

        await expect(alertingOnFailure(fakes.ports, failingStep(STEP_ERROR))).rejects.toBe(STEP_ERROR);
        expect(fakes.notifyModerators).toHaveBeenCalledExactlyOnceWith({
            subject: "Sticky Manager could not refresh its threads",
            bodyMarkdown: [
                "A refresh of the managed threads failed. A thread that was rotating may have lost its live post: the old one unstickied and locked, with no replacement yet.",
                "Sticky Manager tries again within the hour, and sends no further alert until a refresh succeeds.",
                "Details: Reddit is down",
            ].join("\n\n"),
        });
    });

    it("sends nothing while an earlier alert's claim stands", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        fakes.refreshFailureAlert.claim.mockResolvedValue(false);

        await expect(alertingOnFailure(fakes.ports, failingStep(STEP_ERROR))).rejects.toBe(STEP_ERROR);
        expect(fakes.notifyModerators).not.toHaveBeenCalled();
    });

    it("leaves unreadable thread configs to configuration's own alert", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();
        const unreadable = new UnreadableConfigError("the stored thread configs cannot be read");

        await expect(alertingOnFailure(fakes.ports, failingStep(unreadable))).rejects.toBe(unreadable);
        expect(fakes.refreshFailureAlert.claim).not.toHaveBeenCalled();
    });

    it(
        "releases the claim and reports both failures when the alert cannot be sent",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const fakes = createFakeRotationPorts();
            const sendError = new Error("modmail unavailable");
            fakes.notifyModerators.mockRejectedValue(sendError);
            const running = alertingOnFailure(fakes.ports, failingStep(STEP_ERROR));

            await expect(running).rejects.toThrow(
                new Error("Could not alert moderators that a refresh failed (Reddit is down)"),
            );
            await expect(running).rejects.toHaveProperty("cause", sendError);
            expect(fakes.refreshFailureAlert.release).toHaveBeenCalledExactlyOnceWith();
        },
    );

    it("describes a failure that is not an Error by its text", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = createFakeRotationPorts();

        await expect(alertingOnFailure(fakes.ports, failingStep("timeout"))).rejects.toBe("timeout");
        expect(fakes.notifyModerators.mock.lastCall?.[0].bodyMarkdown.endsWith("Details: timeout")).toBe(true);
    });
});
