import { UnreadableConfigError } from "../configuration/index.js";
import type { AlertLatch } from "../notifications/index.js";
import type { RotationPorts } from "./ports.js";

export type ThreadFailureAlertPorts = Pick<RotationPorts, "notifyModerators" | "threadFailureAlert">;

export type RefreshFailureAlertPorts = Pick<RotationPorts, "notifyModerators" | "refreshFailureAlert">;

/** A moderator alert about failed refreshes, sent once until its latch is released. */
interface FailureAlert {
    readonly latch: AlertLatch;
    readonly subject: string;
    /** The paragraphs before the failure's details. */
    readonly explanation: readonly string[];
}

/** A failure in one line, for alerts and the refresh status. */
export function describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

/** Sends `alert` about `error`, once until its latch is released. */
async function alertModerators(
    notifyModerators: RotationPorts["notifyModerators"],
    alert: FailureAlert,
    error: unknown,
): Promise<void> {
    // Configuration alerts moderators to unreadable thread configs itself.
    if (error instanceof UnreadableConfigError || !(await alert.latch.claim())) {
        return;
    }

    const reason = describeFailure(error);
    try {
        await notifyModerators({
            subject: alert.subject,
            bodyMarkdown: [...alert.explanation, `Details: ${reason}`].join("\n\n"),
        });
    } catch (sendError: unknown) {
        // Release the claim, so the next failure retries the alert.
        await alert.latch.release();
        throw new Error(`Could not alert moderators that a refresh failed (${reason})`, { cause: sendError });
    }

    try {
        await alert.latch.confirm();
    } catch (confirmError: unknown) {
        // The claim lapses on its own; releasing it now would send a second alert at the next failure.
        throw new Error(
            `Moderators were alerted that a refresh failed (${reason}), but the alert could not be recorded as sent`,
            { cause: confirmError },
        );
    }
}

/** Runs `step`; if it fails, `alert` goes to moderators (once until its latch is released) and the failure is passed on. */
async function alertingOnFailure(
    notifyModerators: RotationPorts["notifyModerators"],
    alert: FailureAlert,
    step: () => Promise<void>,
): Promise<void> {
    try {
        await step();
    } catch (error: unknown) {
        await alertModerators(notifyModerators, alert, error);
        throw error;
    }
}

/**
 * Runs a refresh of the named thread config; if it fails, moderators are alerted about that thread config (once until
 * it refreshes successfully again) and the failure is passed on.
 */
export async function alertingOnThreadFailure(
    ports: ThreadFailureAlertPorts,
    configName: string,
    step: () => Promise<void>,
): Promise<void> {
    await alertingOnFailure(
        ports.notifyModerators,
        {
            latch: ports.threadFailureAlert(configName),
            subject: `Sticky Manager could not refresh thread config ${configName}`,
            explanation: [
                `A refresh of thread config ${configName} failed. If it interrupted a rotation, the thread is part-way through it: its old post may be unstickied and not yet replaced, or its new post not yet stickied and the old one not yet locked.`,
                "Sticky Manager tries again within 15 minutes and finishes any interrupted rotation. It sends no further alert about this thread config until it refreshes successfully.",
            ],
        },
        step,
    );
}

/**
 * Runs `step`, which checks or schedules refreshes; if it fails, moderators are alerted (once until a refresh check
 * succeeds) and the failure is passed on.
 */
export async function alertingOnRefreshFailure(
    ports: RefreshFailureAlertPorts,
    step: () => Promise<void>,
): Promise<void> {
    await alertingOnFailure(
        ports.notifyModerators,
        {
            latch: ports.refreshFailureAlert,
            subject: "Sticky Manager could not schedule its refreshes",
            explanation: [
                "Sticky Manager could not check or schedule its refreshes, so a managed thread may not rotate on time.",
                "It tries again at the next hourly check. It sends no further alert of this kind until a check succeeds.",
            ],
        },
        step,
    );
}
