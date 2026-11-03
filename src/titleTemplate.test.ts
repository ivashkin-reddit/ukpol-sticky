import { describe, expect, it } from "vitest";
import { findDateToken, renderTitle } from "./titleTemplate.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };
const NOW = new Date("2026-04-21T10:00:00Z");

describe(findDateToken, (): void => {
    it("returns undefined for a title without a date token", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findDateToken("Daily thread")).toBeUndefined();
    });

    it("returns the token text and its date-fns format string", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(findDateToken("Daily thread {{date yyyy-MM-dd}}")).toStrictEqual({
            text: "{{date yyyy-MM-dd}}",
            dateFormat: "yyyy-MM-dd",
        });
    });
});

describe(renderTitle, (): void => {
    it("returns a title without a date token unchanged", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(renderTitle("Daily thread", NOW)).toBe("Daily thread");
    });

    it("replaces the date token with the formatted date", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(renderTitle("Daily thread for {{date EEEE d MMMM yyyy}}", NOW)).toBe(
            "Daily thread for Tuesday 21 April 2026",
        );
    });

    it("keeps dollar sequences in the formatted date literally", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        // `$&` in a replacement string would re-insert the matched token; the replacer function must not.
        expect(renderTitle("Price {{date 'US$&'}}", NOW)).toBe("Price US$&");
    });
});
