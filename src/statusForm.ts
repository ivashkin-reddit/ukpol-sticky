import type { Form, FormField } from "@devvit/web/shared";
import type { ConfigPageStatus } from "./configuration/index.js";
import { needsAttention } from "./rotation/index.js";
import type { ReadableThreadStatus, ThreadStatus, ThreadStatuses } from "./rotation/index.js";
import {
    cut,
    describeAttention,
    describeComments,
    describeConfigPage,
    describeHandover,
    describeLastRefresh,
    describeLastSuccess,
    describeLivePost,
    describeNextRefresh,
    describeSummary,
    formatUtc,
    UNREADABLE_SUMMARY,
} from "./statusText.js";

// The status form: read-only fields, and one select for opening a live post. Field names come from each group's
// position, never from a thread config's name, which may be any string.

/** The status form's name, as devvit.json declares it. */
export const STATUS_FORM_NAME = "statusForm";
/** The status form's only field a moderator fills in: the thread config whose live post to open. */
export const STATUS_FORM_CHOICE = "threadConfig";

/** What the status shows, as of `now`. */
export interface StatusView {
    readonly now: Date;
    readonly config: ConfigPageStatus;
    /** Undefined when the stored thread configs cannot be read. */
    readonly threads: ThreadStatuses | undefined;
    /** A line the description opens with, such as why a live post did not open. */
    readonly notice: string | undefined;
}

function shown(name: string, label: string, text: string): FormField {
    return { type: "string", name, label, defaultValue: text, disabled: true };
}

function shownParagraph(name: string, label: string, text: string): FormField {
    return { type: "paragraph", name, label, defaultValue: cut(text), disabled: true };
}

function readableFields(status: ReadableThreadStatus, prefix: string, now: Date): FormField[] {
    const { livePost, refreshStatus, handover, attention } = status;
    return [
        shown(`${prefix}-live-post`, "Live post", describeLivePost(livePost, now)),
        ...(livePost.kind === "none" ? [] : [shown(`${prefix}-comments`, "Comments", describeComments(livePost))]),
        shown(`${prefix}-next-refresh`, "Next refresh", describeNextRefresh(status, now)),
        shownParagraph(`${prefix}-last-refresh`, "Last refresh", describeLastRefresh(refreshStatus.lastRefresh, now)),
        ...(refreshStatus.lastRefresh?.outcome === "failed"
            ? [shown(`${prefix}-last-success`, "Last success", describeLastSuccess(refreshStatus.lastSuccessAt, now))]
            : []),
        ...(handover === undefined ? [] : [shown(`${prefix}-handover`, "Handover", describeHandover(handover))]),
        ...(attention.length === 0
            ? []
            : [shownParagraph(`${prefix}-attention`, "Needs attention", attention.map(describeAttention).join("\n"))]),
    ];
}

function threadGroup(status: ThreadStatus, index: number, now: Date): FormField {
    const prefix = `thread-${String(index + 1)}`;
    return {
        type: "group",
        label: needsAttention(status) ? `${status.configName}: needs attention` : status.configName,
        fields:
            status.kind === "unreadable"
                ? [shown(`${prefix}-status`, "Status", "Could not read its status.")]
                : readableFields(status, prefix, now),
    };
}

/** The select of thread configs whose live post can be opened; none when no live post can be. */
function livePostChoice(threads: readonly ThreadStatus[]): FormField[] {
    const options = threads.flatMap((status: ThreadStatus): { label: string; value: string }[] =>
        status.kind === "readable" && status.livePost.kind === "readable"
            ? [{ label: `${status.configName}: ${status.livePost.title}`, value: status.configName }]
            : [],
    );
    return options.length === 0
        ? []
        : [
              {
                  type: "select",
                  name: STATUS_FORM_CHOICE,
                  label: "Open a live post",
                  helpText: "Leave this empty to reload the status.",
                  options,
                  required: false,
              },
          ];
}

function threadFields(threads: ThreadStatuses, now: Date): FormField[] {
    return [
        ...(threads.disabled.length === 0 ? [] : [shown("disabled", "Disabled", threads.disabled.join(", "))]),
        ...livePostChoice(threads.threads),
        ...threads.threads.map((status: ThreadStatus, index: number): FormField => threadGroup(status, index, now)),
    ];
}

/** The status form: the summary and the config page, then each thread config in force, those needing attention first. */
export function layOutStatus(view: StatusView): Form {
    const { config, threads, now, notice } = view;
    const asOf = `As of ${formatUtc(now)}.`;
    return {
        title: "Sticky Manager status",
        description: notice === undefined ? asOf : `${notice} ${asOf}`,
        fields: [
            shown("summary", "Summary", threads === undefined ? UNREADABLE_SUMMARY : describeSummary(threads)),
            shownParagraph("config-page", "Config page", describeConfigPage(config)),
            ...(threads === undefined ? [] : threadFields(threads, now)),
        ],
        acceptLabel: "Open",
        cancelLabel: "Close",
    };
}
