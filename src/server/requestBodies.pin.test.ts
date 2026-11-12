import { describe, expect, it } from "vitest";
import type { PinFormEvent } from "../pinToSlot.js";
import { readPinFormEvent, readPinMenuEvent } from "./requestBodies.js";
import type { JsonObject } from "./requestBodies.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(readPinMenuEvent, (): void => {
    it.for<readonly [JsonObject, string | undefined]>([
        [{ location: "post", targetId: "t3_abc" }, "t3_abc"],
        [{ location: "comment", targetId: "t1_abc" }, undefined],
        [{ location: "subreddit", targetId: "t5_abc" }, undefined],
        [{ targetId: 42 }, undefined],
        [{ targetId: ["t3_abc"] }, undefined],
        [{}, undefined],
    ])(
        "reads the post in %j as %j",
        TEST_OPTIONS,
        ([body, postId]: readonly [JsonObject, string | undefined]): void => {
            expect.assertions(1);

            expect(readPinMenuEvent(body)).toStrictEqual({ postId });
        },
    );
});

describe(readPinFormEvent, (): void => {
    it("reads each select's one choice", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            readPinFormEvent({
                "post": ["t3_a"],
                "slot": ["2"],
                "label": ["event"],
                "confirmUnpin": ["t3_f"],
                "highlights-now": "anything a client sends",
                "extra": ["ignored"],
            }),
        ).toStrictEqual({ postId: "t3_a", slot: "2", label: "event", confirmUnpin: "t3_f" });
    });

    it.for<readonly [JsonObject, PinFormEvent]>([
        [{}, { postId: undefined, slot: undefined, label: undefined, confirmUnpin: undefined }],
        [
            { post: [], slot: ["1", "2"], label: "event", confirmUnpin: [7] },
            { postId: undefined, slot: undefined, label: undefined, confirmUnpin: undefined },
        ],
    ])(
        "reads a missing, empty, multiple or mistyped choice in %j as none",
        TEST_OPTIONS,
        ([body, event]: readonly [JsonObject, PinFormEvent]): void => {
            expect.assertions(1);

            expect(readPinFormEvent(body)).toStrictEqual(event);
        },
    );
});
