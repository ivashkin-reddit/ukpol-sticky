import { Post } from "@devvit/public-api";
import { getRefreshTime } from "./stickyManager.js";
import { Config } from "./config.js";

test("getRefreshTime with daily frequency", () => {
    const post = {
        createdAt: new Date("2023-02-01T12:00:00Z"),
    } as unknown as Post;

    const config = {
        frequency: "daily",
        postTime: "14:00",
    } as unknown as Config;

    const expected = new Date("2023-02-02T14:00:00Z");
    const result = getRefreshTime(post, config);
    expect(result.toISOString()).toBe(expected.toISOString());
});

test("getRefreshTime with weekly frequency", () => {
    const post = {
        createdAt: new Date("2025-02-06T12:00:00Z"),
    } as unknown as Post;

    const config = {
        frequency: "wednesdays",
        postTime: "01:00",
    } as unknown as Config;

    const expected = new Date("2025-02-12T01:00:00Z");
    const result = getRefreshTime(post, config);
    expect(result.toISOString()).toBe(expected.toISOString());
});
