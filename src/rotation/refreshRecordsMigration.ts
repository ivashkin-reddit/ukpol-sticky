import type { RotationPorts } from "./ports.js";
import { inRefreshOrder } from "./threadConfigOrder.js";

export type MigrationPorts = Pick<RotationPorts, "appliedThreadConfigs" | "retiredRefreshRecords" | "threadConfigs">;

/** The JSON of each thread config in a record of applied thread configs; none when the record is not a JSON list. */
function parseAppliedJson(record: string): ReadonlySet<string> {
    try {
        const parsed: unknown = JSON.parse(record);
        return new Set(Array.isArray(parsed) ? parsed.map((config: unknown): string => JSON.stringify(config)) : []);
    } catch (error: unknown) {
        if (!(error instanceof SyntaxError)) {
            throw error;
        }

        console.warn("The record of applied thread configs is not JSON, so none is migrated:", error);
        return new Set();
    }
}

/**
 * Moves the record of applied thread configs kept for all thread configs to one per thread config, then deletes it and
 * the refresh status kept for all. A thread config in force that the old record shows applied is recorded as applied
 * on its own; one that differs, saved but not yet applied, stays unapplied and is refreshed at once. Safe to repeat:
 * once the old records are gone, it migrates nothing.
 */
export async function migrateRefreshRecords(ports: MigrationPorts): Promise<void> {
    const record = await ports.retiredRefreshRecords.readAppliedThreadConfigs();
    if (record !== undefined) {
        const appliedJson = parseAppliedJson(record);
        const configs = inRefreshOrder(await ports.threadConfigs());
        const migrated = configs.filter((config): boolean => appliedJson.has(JSON.stringify(config)));
        await Promise.all(
            migrated.map(async (config): Promise<void> => {
                await ports.appliedThreadConfigs.record(config);
            }),
        );
        console.log(
            `Migrated the applied thread configs: ${String(migrated.length)} of ${String(configs.length)} thread configs in force recorded as applied.`,
        );
    }

    await ports.retiredRefreshRecords.delete();
}
