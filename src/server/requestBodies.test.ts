import type { TaskRequest } from "@devvit/web/server";
import type {
    OnAppInstallRequest,
    OnAppUpgradeRequest,
    OnCommentCreateRequest,
    OnModActionRequest,
    OnPostDeleteRequest,
} from "@devvit/web/shared";
import { describe, expect, expectTypeOf, it } from "vitest";
import type { CommentCreateEvent, ModActionEvent, PostDeleteEvent, RefreshJobEvent } from "../triggers.js";
import {
    isJsonObject,
    readCommentCreateEvent,
    readModActionEvent,
    readPostDeleteEvent,
    readRefreshJobEvent,
} from "./requestBodies.js";
import type { JsonObject } from "./requestBodies.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

describe(isJsonObject, (): void => {
    it.for<unknown>([{}, { postId: "t3_alpha" }])(
        "accepts a JSON object (%j)",
        TEST_OPTIONS,
        (value: unknown): void => {
            expect.assertions(1);

            expect(isJsonObject(value)).toBe(true);
        },
    );

    it.for<unknown>([null, [], [{}], "text", 42, true, undefined])(
        "rejects what is not a JSON object (%j)",
        TEST_OPTIONS,
        (value: unknown): void => {
            expect.assertions(1);

            expect(isJsonObject(value)).toBe(false);
        },
    );
});

describe(readModActionEvent, (): void => {
    it.for<readonly [JsonObject, ModActionEvent]>([
        [
            {
                type: "ModAction",
                action: "wikirevise",
                moderator: { id: "t2_mod", name: "mod_user" },
                subreddit: { id: "t5_testsub", name: "testsub" },
            },
            { action: "wikirevise", moderator: { name: "mod_user" } },
        ],
        [{}, { action: undefined, moderator: undefined }],
        [
            { action: 7, moderator: "mod_user" },
            { action: undefined, moderator: undefined },
        ],
        [
            { action: "wikirevise", moderator: { name: 7 } },
            { action: "wikirevise", moderator: undefined },
        ],
    ])(
        "keeps the action and the moderator's name, reading a missing or mistyped one as absent (%j)",
        TEST_OPTIONS,
        ([body, event]: readonly [JsonObject, ModActionEvent]): void => {
            expect.assertions(1);

            expect(readModActionEvent(body)).toStrictEqual(event);
        },
    );
});

describe(readCommentCreateEvent, (): void => {
    it.for<readonly [JsonObject, CommentCreateEvent]>([
        [
            {
                type: "CommentCreate",
                author: { id: "t2_someone", name: "someone" },
                post: { id: "t3_alpha", numComments: 42, title: "Daily thread" },
                comment: { id: "t1_beta", body: "Hello" },
            },
            { author: { name: "someone" }, post: { id: "t3_alpha", numComments: 42 } },
        ],
        [{}, { author: undefined, post: undefined }],
        [{ post: { numComments: 42 } }, { author: undefined, post: undefined }],
        [
            { author: { name: 7 }, post: { id: "t3_alpha", numComments: "42" } },
            { author: undefined, post: { id: "t3_alpha", numComments: undefined } },
        ],
    ])(
        "keeps the author's name and the post's ID and comment count, reading a missing or mistyped one as absent (%j)",
        TEST_OPTIONS,
        ([body, event]: readonly [JsonObject, CommentCreateEvent]): void => {
            expect.assertions(1);

            expect(readCommentCreateEvent(body)).toStrictEqual(event);
        },
    );
});

describe(readPostDeleteEvent, (): void => {
    it.for<readonly [JsonObject, PostDeleteEvent]>([
        [{ type: "PostDelete", postId: "t3_alpha", source: 1, reason: 1 }, { postId: "t3_alpha" }],
        [{}, { postId: undefined }],
        [{ postId: 7 }, { postId: undefined }],
    ])(
        "keeps the post ID, reading a missing or mistyped one as absent (%j)",
        TEST_OPTIONS,
        ([body, event]: readonly [JsonObject, PostDeleteEvent]): void => {
            expect.assertions(1);

            expect(readPostDeleteEvent(body)).toStrictEqual(event);
        },
    );
});

describe(readRefreshJobEvent, (): void => {
    it.for<readonly [JsonObject, RefreshJobEvent]>([
        [{ name: "RefreshStickyPosts", data: { configName: "daily-thread" } }, { configName: "daily-thread" }],
        [{ name: "RefreshStickyPosts", data: { configName: "" } }, { configName: "" }],
        [{ name: "RefreshStickyPosts", data: { configName: 42 } }, { configName: undefined }],
        [{ name: "RefreshStickyPosts", data: ["daily-thread"] }, { configName: undefined }],
        [{ name: "RefreshStickyPosts" }, { configName: undefined }],
    ])(
        "reads the thread config a refresh job names (%j)",
        TEST_OPTIONS,
        ([body, event]: readonly [JsonObject, RefreshJobEvent]): void => {
            expect.assertions(1);

            expect(readRefreshJobEvent(body)).toStrictEqual(event);
        },
    );
});

// Compile-time contract: `npm run typecheck` fails when a Devvit upgrade renames or retypes a field the server reads.
// The edge's event fields are optional, so only a per-field check catches a payload that lost one.
describe("the request types Devvit Web sends", (): void => {
    it("still carry ModAction's action and moderator name", TEST_OPTIONS, (): void => {
        expect.assertions(0);

        expectTypeOf<OnModActionRequest["action"]>().toEqualTypeOf<string | undefined>();
        expectTypeOf<NonNullable<OnModActionRequest["moderator"]>["name"]>().toEqualTypeOf<string>();
    });

    it("still carry CommentCreate's author name, post ID and comment count", TEST_OPTIONS, (): void => {
        expect.assertions(0);

        expectTypeOf<NonNullable<OnCommentCreateRequest["author"]>["name"]>().toEqualTypeOf<string>();
        expectTypeOf<NonNullable<OnCommentCreateRequest["post"]>["id"]>().toEqualTypeOf<string>();
        expectTypeOf<NonNullable<OnCommentCreateRequest["post"]>["numComments"]>().toEqualTypeOf<number>();
    });

    it("still carry PostDelete's post ID", TEST_OPTIONS, (): void => {
        expect.assertions(0);

        expectTypeOf<OnPostDeleteRequest["postId"]>().toEqualTypeOf<string>();
    });

    it("still carry a task's data as a JSON object", TEST_OPTIONS, (): void => {
        expect.assertions(0);

        expectTypeOf<NonNullable<TaskRequest["data"]>>().toExtend<JsonObject>();
    });

    it("are JSON objects, as are install, upgrade and task requests", TEST_OPTIONS, (): void => {
        expect.assertions(0);

        expectTypeOf<OnAppInstallRequest>().toExtend<JsonObject>();
        expectTypeOf<OnAppUpgradeRequest>().toExtend<JsonObject>();
        expectTypeOf<TaskRequest>().toExtend<JsonObject>();
    });
});
