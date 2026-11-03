import { UnreadableConfigError } from "../configuration/index.js";
import type { RotationPorts } from "./ports.js";

export type FailureAlertPorts = Pick<RotationPorts, "notifyModerators" | "refreshFailureAlert">;

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Alerts moderators that a refresh failed, once until a refresh succeeds again. */
async function alertModerators(ports: FailureAlertPorts, error: unknown): Promise<void> {
    // Configuration alerts moderators to unreadable thread configs itself.
    if (error instanceof UnreadableConfigError || !(await ports.refreshFailureAlert.claim())) {
        return;
    }

    const reason = describe(error);
    try {
        await ports.notifyModerators({
            subject: "Sticky Manager could not refresh its threads",
            bodyMarkdown: [
                "A refresh of the managed threads failed. A thread that was rotating may have lost its live post: the old one unstickied and locked, with no replacement yet.",
                "Sticky Manager tries again within the hour, and sends no further alert until a refresh succeeds.",
                `Details: ${reason}`,
            ].join("\n\n"),
        });
    } catch (sendError: unknown) {
        // Release the claim, so the next failure retries the alert.
        await ports.refreshFailureAlert.release();
        throw new Error(`Could not alert moderators that a refresh failed (${reason})`, { cause: sendError });
    }
}

/** Runs `step`; if it fails, moderators are alerted (once per outage) and the failure is passed on. */
export async function alertingOnFailure(ports: FailureAlertPorts, step: () => Promise<void>): Promise<void> {
    try {
        await step();
    } catch (error: unknown) {
        await alertModerators(ports, error);
        throw error;
    }
}
