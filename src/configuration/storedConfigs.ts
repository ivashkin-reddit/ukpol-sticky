import { CONFIG_PAGE } from "./domain/threadConfig.js";
import type { ThreadConfig } from "./domain/threadConfig.js";
import { UnreadableConfigError } from "./ports.js";
import type { ConfigReadPorts } from "./ports.js";

/** Stores accepted thread configs. They are readable again, so a later breakage alerts moderators again. */
export async function storeThreadConfigs(
    configs: readonly ThreadConfig[],
    ports: Pick<ConfigReadPorts, "store" | "unreadableAlert">,
): Promise<void> {
    await ports.store.writeConfigs(configs);
    await ports.unreadableAlert.release();
}

/** Sends moderators one alert per broken stored copy; the latch lets concurrent readers agree on one sender. */
async function alertModeratorsOnce(ports: ConfigReadPorts, reason: string): Promise<void> {
    if (!(await ports.unreadableAlert.claim())) {
        return;
    }

    try {
        await ports.notifyModerators({
            subject: "Sticky Manager cannot read its stored config",
            bodyMarkdown: [
                "The app's stored copy of the config cannot be read, so sticky posts will not be refreshed or replaced at their comment caps.",
                `Edit and save the wiki page ${CONFIG_PAGE} (any change will do) to store a fresh copy.`,
                `Details: ${reason}`,
            ].join("\n\n"),
        });
    } catch (sendError: unknown) {
        // Release the claim, so the next read retries the alert.
        await ports.unreadableAlert.release();
        throw new Error(`Could not alert moderators that the stored config cannot be read (${reason})`, {
            cause: sendError,
        });
    }
}

async function readStoredConfigs(ports: ConfigReadPorts): Promise<readonly ThreadConfig[] | undefined> {
    try {
        return await ports.store.readConfigs();
    } catch (error: unknown) {
        if (error instanceof UnreadableConfigError) {
            await alertModeratorsOnce(ports, error.message);
        }

        throw error;
    }
}

/**
 * The accepted thread configs, or an empty list when none has been stored yet.
 * A stored copy that cannot be read throws an UnreadableConfigError rather than reading as empty: an empty list means
 * "every thread config removed", and the next refresh would forget every live post. Moderators get one alert asking
 * them to re-save the config page, which stores a fresh, validated copy.
 */
export async function getThreadConfigs(ports: ConfigReadPorts): Promise<readonly ThreadConfig[]> {
    const configs = await readStoredConfigs(ports);
    if (configs === undefined) {
        console.log("No thread configs are stored yet.");
        return [];
    }

    return configs;
}
