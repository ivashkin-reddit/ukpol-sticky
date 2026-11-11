import { describe, expect, it } from "vitest";
import { isHighlightLabel, labelName } from "./labels.js";
import type { HighlightLabel } from "./labels.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(labelName, (): void => {
    it.for<readonly [HighlightLabel, string]>([
        ["megathread", "Megathread"],
        ["announcement", "Announcement"],
        ["event", "Event"],
    ])("names %s %s", TEST_OPTIONS, ([label, name]: readonly [HighlightLabel, string]): void => {
        expect.assertions(1);

        expect(labelName(label)).toBe(name);
    });

    it("names no label as undefined", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(labelName(undefined)).toBeUndefined();
    });
});

describe(isHighlightLabel, (): void => {
    it.for(["megathread", "announcement", "event"])("accepts %s", TEST_OPTIONS, (value: string): void => {
        expect.assertions(1);

        expect(isHighlightLabel(value)).toBe(true);
    });

    it.for(["none", "MEGATHREAD", "", "show_post_flair"])("refuses %j", TEST_OPTIONS, (value: string): void => {
        expect.assertions(1);

        expect(isHighlightLabel(value)).toBe(false);
    });
});
