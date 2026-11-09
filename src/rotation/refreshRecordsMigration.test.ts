import { describe, expect, it } from "vitest";
import { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";
import { DISABLED_CONFIG, LOOSE_CONFIG, STICKY_CONFIG } from "../../tests/support/rotationFixtures.js";
import { silenceConsole } from "../../tests/support/silenceConsole.js";
import { migrateRefreshRecords } from "./refreshRecordsMigration.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

/** Fakes over the sticky, an edited loose and the disabled thread config, none with an applied version recorded. */
async function beforeTheUpgrade(): Promise<FakeRotationPorts> {
    const fakes = createFakeRotationPorts([STICKY_CONFIG, { ...LOOSE_CONFIG, body: "Edited body" }, DISABLED_CONFIG]);
    await fakes.ports.appliedThreadConfigs.forget(["sticky-thread", "loose-thread"]);
    fakes.appliedThreadConfigs.record.mockClear();
    return fakes;
}

describe(migrateRefreshRecords, (): void => {
    it(
        "records each thread config in force that the old record shows applied, then deletes the old records",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const fakes = await beforeTheUpgrade();
            fakes.retiredRefreshRecords.readAppliedThreadConfigs.mockResolvedValue(
                JSON.stringify([STICKY_CONFIG, LOOSE_CONFIG, DISABLED_CONFIG]),
            );

            await migrateRefreshRecords(fakes.ports);

            expect(fakes.appliedThreadConfigs.record).toHaveBeenCalledExactlyOnceWith(STICKY_CONFIG);
            expect(fakes.retiredRefreshRecords.delete).toHaveBeenCalledAfter(fakes.appliedThreadConfigs.record);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Migrated the applied thread configs: 1 of 2 thread configs in force recorded as applied.",
            );
        },
    );

    it("deletes the old records, migrating nothing, when none is stored", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const fakes = await beforeTheUpgrade();

        await migrateRefreshRecords(fakes.ports);

        expect(fakes.appliedThreadConfigs.record).not.toHaveBeenCalled();
        expect(fakes.retiredRefreshRecords.delete).toHaveBeenCalledExactlyOnceWith();
    });

    it.for(["not json", "{}"])(
        "migrates nothing from a record that is not a JSON list (%s)",
        TEST_OPTIONS,
        async (record: string): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            silenceConsole("warn");
            const fakes = await beforeTheUpgrade();
            fakes.retiredRefreshRecords.readAppliedThreadConfigs.mockResolvedValue(record);

            await migrateRefreshRecords(fakes.ports);

            expect(fakes.appliedThreadConfigs.record).not.toHaveBeenCalled();
            expect(fakes.retiredRefreshRecords.delete).toHaveBeenCalledExactlyOnceWith();
        },
    );
});
