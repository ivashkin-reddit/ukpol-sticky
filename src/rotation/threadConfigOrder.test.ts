import { describe, expect, it } from "vitest";
import type { ThreadConfig } from "../configuration/index.js";
import { inRefreshOrder } from "./threadConfigOrder.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const CONFIG: ThreadConfig = { name: "loose", enabled: true, title: "Loose", maxComments: 10, body: "Body" };

describe(inRefreshOrder, (): void => {
    it("puts thread configs pinned by slot or by sticky first, in page order", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        const configs: readonly ThreadConfig[] = [
            CONFIG,
            { ...CONFIG, name: "slotted", slot: 2 },
            { ...CONFIG, name: "unpinned", sticky: false },
            { ...CONFIG, name: "sticky", sticky: true },
        ];

        expect(inRefreshOrder(configs).map((config: ThreadConfig): string => config.name)).toStrictEqual([
            "slotted",
            "sticky",
            "loose",
            "unpinned",
        ]);
    });
});
