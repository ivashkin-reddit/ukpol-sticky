import { getRefreshTime } from "./stickyManager.js";
import { Config } from "./config.js";

test("getRefreshTime with daily frequency", () => {
    const config = {
        frequency: "daily",
        postTime: "14:00",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:00:00Z");
    const result = getRefreshTime(new Date("2023-02-02T02:00:00Z"), config);
    expect(result.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with daily frequency and recent refresh", () => {
    const config = {
        frequency: "daily",
        postTime: "14:00",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:00:00Z");
    const result = getRefreshTime(new Date("2023-02-01T13:00:00Z"), config);
    expect(result.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency", () => {
    const config = {
        frequency: "wednesdays",
        postTime: "01:00",
    } as unknown as Config;

    const expected = new Date("2025-02-12T01:00:00Z");
    const result = getRefreshTime(new Date("2025-02-06T12:00:00Z"), config);
    expect(result.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency and recent refresh", () => {
    const config = {
        frequency: "wednesdays",
        postTime: "01:00",
    } as unknown as Config;

    const expected = new Date("2025-02-19T01:00:00Z");
    const result = getRefreshTime(new Date("2025-02-12T00:30:00Z"), config);
    expect(result.toISOString()).toBe(expected.toISOString());
});
