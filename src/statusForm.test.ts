import type { Form, FormField } from "@devvit/web/shared";
import { describe, expect, it } from "vitest";
import type { ConfigPageStatus } from "./configuration/index.js";
import type { ReadableThreadStatus } from "./rotation/index.js";
import { layOutStatus } from "./statusForm.js";

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const NOW = new Date("2026-04-21T10:00:00Z");

const CONFIG_IN_FORCE: ConfigPageStatus = {
    page: { kind: "inForce", savedBy: "mod_user" },
    threadConfigs: { kind: "readable", configs: [] },
};

const HEALTHY: ReadableThreadStatus = {
    kind: "readable",
    configName: "daily-thread",
    hasSchedule: true,
    livePost: {
        kind: "readable",
        id: "t3_daily",
        title: "Daily thread",
        stickied: true,
        createdAt: new Date("2026-04-21T05:00:00Z"),
        comments: 12,
        commentCap: 100,
    },
    refreshStatus: {
        lastRefresh: { at: new Date("2026-04-21T05:00:00Z"), outcome: "succeeded" },
        lastSuccessAt: new Date("2026-04-21T05:00:00Z"),
        nextRefreshAt: new Date("2026-04-21T12:30:05Z"),
        nextRefreshReason: "to rotate it",
    },
    handover: undefined,
    attention: [],
};

const FAILING: ReadableThreadStatus = {
    kind: "readable",
    configName: "loose-thread",
    hasSchedule: false,
    livePost: { kind: "unreadable", postId: "t3_loose" },
    refreshStatus: {
        lastRefresh: { at: new Date("2026-04-21T09:50:00Z"), outcome: "failed", failure: "Reddit is down" },
        lastSuccessAt: undefined,
        nextRefreshAt: new Date("2026-04-21T10:05:05Z"),
        nextRefreshReason: "to retry it after a failure",
    },
    handover: { newPostId: "t3_new", oldPostId: "t3_loose" },
    attention: [{ kind: "failed" }, { kind: "postUnreadable" }],
};

function shown(name: string, label: string, defaultValue: string): FormField {
    return { type: "string", name, label, defaultValue, disabled: true };
}

function shownParagraph(name: string, label: string, defaultValue: string): FormField {
    return { type: "paragraph", name, label, defaultValue, disabled: true };
}

/** A form field as these checks read it: Devvit's field types have mutable arrays, which this view keeps read-only. */
type FieldView = Readonly<{ name?: string; defaultValue?: unknown; fields?: readonly FieldView[] }>;

/** Every field's name, groups' fields included, in order. */
function namesOf(fields: readonly FieldView[]): readonly string[] {
    return fields.flatMap((field: FieldView): readonly string[] => {
        if (field.fields !== undefined) {
            return namesOf(field.fields);
        }

        return field.name === undefined ? [] : [field.name];
    });
}

/** The text a field named `name` shows, wherever it is in the form. */
function textOf(fields: readonly FieldView[], name: string): unknown {
    return fields
        .flatMap((field: FieldView): readonly FieldView[] => field.fields ?? [field])
        .find((field: FieldView): boolean => field.name === name)?.defaultValue;
}

describe(layOutStatus, (): void => {
    it(
        "lays out the summary, the config page, the disabled thread configs, the choice and each thread config",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            const expected: Form = {
                title: "Sticky Manager status",
                description: "As of 2026-04-21 10:00 UTC.",
                acceptLabel: "Open",
                cancelLabel: "Close",
                fields: [
                    shown("summary", "Summary", "2 managed threads: 1 running, 1 needs attention."),
                    shownParagraph(
                        "config-page",
                        "Config page",
                        "Its latest revision is in force, saved by /u/mod_user.",
                    ),
                    shown("disabled", "Disabled", "weekly-thread, ama-thread"),
                    {
                        type: "select",
                        name: "threadConfig",
                        label: "Open a live post",
                        helpText: "Leave this empty to reload the status.",
                        options: [{ label: "daily-thread: Daily thread", value: "daily-thread" }],
                        required: false,
                    },
                    {
                        type: "group",
                        label: "loose-thread: needs attention",
                        fields: [
                            shown("thread-1-live-post", "Live post", "Could not read t3_loose from Reddit."),
                            shown("thread-1-comments", "Comments", "Unknown"),
                            shown(
                                "thread-1-next-refresh",
                                "Next refresh",
                                "2026-04-21 10:05 UTC (in 5 minutes), to retry it after a failure",
                            ),
                            shownParagraph(
                                "thread-1-last-refresh",
                                "Last refresh",
                                "Failed 2026-04-21 09:50 UTC (10 minutes ago): Reddit is down",
                            ),
                            shown("thread-1-last-success", "Last success", "Never"),
                            shown(
                                "thread-1-handover",
                                "Handover",
                                "Unfinished: new post t3_new is published; the next refresh finishes the handover.",
                            ),
                            shownParagraph(
                                "thread-1-attention",
                                "Needs attention",
                                "Its last refresh failed; it is retried within 15 minutes.\nIts live post could not be read from Reddit.",
                            ),
                        ],
                    },
                    {
                        type: "group",
                        label: "daily-thread",
                        fields: [
                            shown(
                                "thread-2-live-post",
                                "Live post",
                                "Daily thread (t3_daily), stickied, posted 2026-04-21 05:00 UTC (5 hours ago)",
                            ),
                            shown("thread-2-comments", "Comments", "12 of 100"),
                            shown(
                                "thread-2-next-refresh",
                                "Next refresh",
                                "2026-04-21 12:30 UTC (in 3 hours), to rotate it",
                            ),
                            shownParagraph(
                                "thread-2-last-refresh",
                                "Last refresh",
                                "Succeeded 2026-04-21 05:00 UTC (5 hours ago)",
                            ),
                        ],
                    },
                ],
            };

            expect(
                layOutStatus({
                    now: NOW,
                    config: CONFIG_IN_FORCE,
                    threads: {
                        threads: [FAILING, HEALTHY],
                        disabled: ["weekly-thread", "ama-thread"],
                        hourlyCheckScheduled: true,
                    },
                    notice: undefined,
                }),
            ).toStrictEqual(expected);
        },
    );

    it(
        "shows only the summary and the config page when the stored thread configs cannot be read",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            expect(
                layOutStatus({
                    now: NOW,
                    config: { page: { kind: "unchecked" }, threadConfigs: { kind: "unreadable" } },
                    threads: undefined,
                    notice: undefined,
                }).fields,
            ).toStrictEqual([
                shown("summary", "Summary", "Sticky Manager cannot read its stored thread configs."),
                shownParagraph(
                    "config-page",
                    "Config page",
                    "The stored thread configs cannot be read, so refreshes have stopped. Save the config page again to store a fresh copy.",
                ),
            ]);
        },
    );

    it(
        "omits the choice when no live post can be opened, and omits Comments with no live post",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            const form = layOutStatus({
                now: NOW,
                config: CONFIG_IN_FORCE,
                threads: {
                    threads: [{ ...HEALTHY, livePost: { kind: "none" } }],
                    disabled: [],
                    hourlyCheckScheduled: true,
                },
                notice: undefined,
            });

            expect(namesOf(form.fields)).toStrictEqual([
                "summary",
                "config-page",
                "thread-1-live-post",
                "thread-1-next-refresh",
                "thread-1-last-refresh",
            ]);
        },
    );

    it("opens the description with a notice, and cuts a long failure to 500 characters", TEST_OPTIONS, (): void => {
        expect.assertions(2);

        const longFailure: ReadableThreadStatus = {
            ...FAILING,
            refreshStatus: {
                ...FAILING.refreshStatus,
                lastRefresh: { at: new Date("2026-04-21T09:50:00Z"), outcome: "failed", failure: "x".repeat(600) },
            },
        };
        const form = layOutStatus({
            now: NOW,
            config: CONFIG_IN_FORCE,
            threads: { threads: [longFailure], disabled: [], hourlyCheckScheduled: true },
            notice: "The thread config you chose has no live post now.",
        });

        expect(form.description).toBe("The thread config you chose has no live post now. As of 2026-04-21 10:00 UTC.");
        expect(textOf(form.fields, "thread-1-last-refresh")).toHaveLength(500);
    });

    it("shows a thread config whose status could not be read", TEST_OPTIONS, (): void => {
        expect.assertions(1);

        expect(
            layOutStatus({
                now: NOW,
                config: CONFIG_IN_FORCE,
                threads: {
                    threads: [{ kind: "unreadable", configName: "weekly-thread" }],
                    disabled: [],
                    hourlyCheckScheduled: true,
                },
                notice: undefined,
            }).fields.at(-1),
        ).toStrictEqual({
            type: "group",
            label: "weekly-thread: needs attention",
            fields: [shown("thread-1-status", "Status", "Could not read its status.")],
        });
    });
});
