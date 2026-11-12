import type { UiResponse } from "@devvit/web/shared";
import { describe, expect, it, vi } from "vitest";
import { createFakeChangeHistory } from "../tests/support/fakeChangeHistory.js";
import { freezeTime } from "../tests/support/fakeClock.js";
import { createFakeConfigurationPorts } from "../tests/support/fakeConfigurationPorts.js";
import { createFakeDevvitContext } from "../tests/support/fakeDevvitContext.js";
import { createFakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import type { FakeRotationPorts } from "../tests/support/fakeRotationPorts.js";
import { DAILY_CONFIG } from "../tests/support/rotationFixtures.js";
import { silenceConsole } from "../tests/support/silenceConsole.js";
import type { Change } from "./changes/index.js";
import { changesPorts, configurationPorts, rotationPorts } from "./composition.js";
import type * as Composition from "./composition.js";
import type { DevvitContext } from "./composition.js";
import { getConfigPageStatus } from "./configuration/index.js";
import type * as Configuration from "./configuration/index.js";
import type { ConfigPageStatus } from "./configuration/index.js";
import { identifyCaller } from "./moderators.js";
import type * as Moderators from "./moderators.js";
import type { Caller } from "./moderators.js";
import { findLivePostLink, getThreadStatuses } from "./rotation/index.js";
import type * as Rotation from "./rotation/index.js";
import type { ThreadStatuses } from "./rotation/index.js";
import { onStatusForm, onStatusMenu } from "./status.js";
import { layOutStatus } from "./statusForm.js";
import type { StatusView } from "./statusForm.js";

vi.mock(import("./composition.js"), (): Partial<typeof Composition> => ({
    changesPorts: vi.fn<typeof changesPorts>(),
    configurationPorts: vi.fn<typeof configurationPorts>(),
    rotationPorts: vi.fn<typeof rotationPorts>(),
}));

vi.mock(import("./configuration/index.js"), async (importOriginal): Promise<typeof Configuration> => ({
    ...(await importOriginal()),
    getConfigPageStatus: vi.fn<typeof getConfigPageStatus>(),
}));

vi.mock(import("./rotation/index.js"), async (importOriginal): Promise<typeof Rotation> => ({
    ...(await importOriginal()),
    findLivePostLink: vi.fn<typeof findLivePostLink>(),
    getThreadStatuses: vi.fn<typeof getThreadStatuses>(),
}));

vi.mock(import("./moderators.js"), (): Partial<typeof Moderators> => ({
    identifyCaller: vi.fn<typeof identifyCaller>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const MODERATOR: Caller = { kind: "moderator", moderator: { username: "mod_user", permissions: ["all"] } };

const CHANGE: Change = {
    kind: "pin",
    at: new Date("2026-04-21T09:00:00Z"),
    moderator: "mod_user",
    action: "pinned",
    post: { id: "t3_ama", title: "AMA" },
    fromSlot: undefined,
    toSlot: 2,
    label: "Event",
    unpinned: undefined,
};

const CONFIG: ConfigPageStatus = {
    page: { kind: "inForce", savedBy: "mod_user" },
    threadConfigs: { kind: "readable", configs: [DAILY_CONFIG] },
};

const THREADS: ThreadStatuses = { threads: [], disabled: [], hourlyCheckScheduled: true };

interface Wiring {
    readonly context: DevvitContext;
    readonly rotation: FakeRotationPorts;
}

/** The status a moderator is shown now: `view`, laid out. */
function statusShown(view: Pick<StatusView, "changes" | "config" | "notice" | "threads">): UiResponse {
    return { showForm: { name: "statusForm", form: layOutStatus({ ...view, now: new Date() }) } };
}

/** A request's context as of 10:00, the composition root building fake ports from it, and the status read. */
function wired(): Wiring {
    freezeTime("2026-04-21T10:00:00Z");
    const { context } = createFakeDevvitContext();
    const rotation = createFakeRotationPorts();
    vi.mocked(changesPorts).mockReturnValue(createFakeChangeHistory().store);
    vi.mocked(configurationPorts).mockReturnValue(createFakeConfigurationPorts().ports);
    vi.mocked(rotationPorts).mockReturnValue(rotation.ports);
    vi.mocked(getConfigPageStatus).mockResolvedValue(CONFIG);
    vi.mocked(getThreadStatuses).mockResolvedValue(THREADS);
    return { context, rotation };
}

describe(onStatusMenu, (): void => {
    it.for<readonly [string | undefined, string]>([
        ["someone", "Refused the status to u/someone: not a moderator of r/testsub."],
        [undefined, "Refused the status to a request with no user: not a moderator of r/testsub."],
    ])(
        "refuses a caller who is not a moderator (%s) before reading anything",
        TEST_OPTIONS,
        async ([username, line]: readonly [string | undefined, string]): Promise<void> => {
            expect.assertions(3);

            const warnSpy = silenceConsole("warn");
            const { context } = wired();
            vi.mocked(identifyCaller).mockResolvedValue({ kind: "other", username });

            await expect(onStatusMenu({}, context)).resolves.toStrictEqual({
                showToast: "Only moderators of r/testsub can see Sticky Manager's status.",
            });
            expect(warnSpy).toHaveBeenCalledExactlyOnceWith(line);
            expect(vi.mocked(getConfigPageStatus)).not.toHaveBeenCalled();
        },
    );

    it(
        "shows a moderator the status of the thread configs the config page status read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(3);

            const logSpy = silenceConsole("log");
            const { context, rotation } = wired();
            vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);

            await expect(onStatusMenu({}, context)).resolves.toStrictEqual(
                statusShown({ changes: [], config: CONFIG, threads: THREADS, notice: undefined }),
            );
            expect(vi.mocked(getThreadStatuses)).toHaveBeenCalledExactlyOnceWith([DAILY_CONFIG], rotation.ports);
            expect(logSpy).toHaveBeenCalledExactlyOnceWith(
                "Showed the status to u/mod_user: 0 thread configs, 0 need attention.",
            );
        },
    );

    it(
        "shows the config page alone when the stored thread configs cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const { context } = wired();
            const unreadable: ConfigPageStatus = { page: { kind: "unchecked" }, threadConfigs: { kind: "unreadable" } };
            vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);
            vi.mocked(getConfigPageStatus).mockResolvedValue(unreadable);

            await expect(onStatusMenu({}, context)).resolves.toStrictEqual(
                statusShown({ changes: [], config: unreadable, threads: undefined, notice: undefined }),
            );
            expect(vi.mocked(getThreadStatuses)).not.toHaveBeenCalled();
        },
    );

    it("shows the latest changes, newest first", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const { context } = wired();
        const older: Change = { ...CHANGE, at: new Date("2026-04-20T10:00:00Z") };
        vi.mocked(changesPorts).mockReturnValue(createFakeChangeHistory([older, CHANGE]).store);
        vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);

        await expect(onStatusMenu({}, context)).resolves.toStrictEqual(
            statusShown({ changes: [CHANGE, older], config: CONFIG, threads: THREADS, notice: undefined }),
        );
    });

    it(
        "shows the rest of the status, and logs why, when the change history cannot be read",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(2);

            silenceConsole("log");
            const errorSpy = silenceConsole("error");
            const { context } = wired();
            const readError = new Error("Redis is down");
            const history = createFakeChangeHistory();
            history.all.mockRejectedValue(readError);
            vi.mocked(changesPorts).mockReturnValue(history.store);
            vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);

            await expect(onStatusMenu({}, context)).resolves.toStrictEqual(
                statusShown({ changes: "unreadable", config: CONFIG, threads: THREADS, notice: undefined }),
            );
            expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
                "The status could not read the change history:",
                readError,
            );
        },
    );
});

describe(onStatusForm, (): void => {
    it("refuses a caller who is not a moderator before looking anything up", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        silenceConsole("warn");
        const { context } = wired();
        vi.mocked(identifyCaller).mockResolvedValue({ kind: "other", username: "someone" });

        await expect(onStatusForm({ configName: "daily-thread" }, context)).resolves.toStrictEqual({
            showToast: "Only moderators of r/testsub can see Sticky Manager's status.",
        });
        expect(vi.mocked(findLivePostLink)).not.toHaveBeenCalled();
    });

    it("shows the status again when nothing was chosen", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(1);

        silenceConsole("log");
        const { context } = wired();
        vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);

        await expect(onStatusForm({ configName: undefined }, context)).resolves.toStrictEqual(
            statusShown({ changes: [], config: CONFIG, threads: THREADS, notice: undefined }),
        );
    });

    it("opens the chosen thread config's live post on Reddit, and logs it", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(3);

        const logSpy = silenceConsole("log");
        const { context, rotation } = wired();
        vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);
        vi.mocked(findLivePostLink).mockResolvedValue({ postId: "t3_daily", permalink: "/r/testsub/comments/daily/" });

        await expect(onStatusForm({ configName: "daily-thread" }, context)).resolves.toStrictEqual({
            navigateTo: "https://www.reddit.com/r/testsub/comments/daily/",
        });
        expect(vi.mocked(findLivePostLink)).toHaveBeenCalledExactlyOnceWith("daily-thread", rotation.ports);
        expect(logSpy).toHaveBeenCalledExactlyOnceWith(
            "Opened live post t3_daily of thread config daily-thread for u/mod_user.",
        );
    });

    it(
        "shows the status again, saying so without repeating the choice, when the chosen thread config has no live post",
        TEST_OPTIONS,
        async (): Promise<void> => {
            expect.assertions(1);

            silenceConsole("log");
            const { context } = wired();
            vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);
            vi.mocked(findLivePostLink).mockResolvedValue(undefined);

            await expect(onStatusForm({ configName: "<script>" }, context)).resolves.toStrictEqual(
                statusShown({
                    changes: [],
                    config: CONFIG,
                    threads: THREADS,
                    notice: "The thread config you chose has no live post now.",
                }),
            );
        },
    );

    it("says so, without detail, when the live post cannot be read", TEST_OPTIONS, async (): Promise<void> => {
        expect.assertions(2);

        const errorSpy = silenceConsole("error");
        const failure = new Error("Reddit is down");
        const { context } = wired();
        vi.mocked(identifyCaller).mockResolvedValue(MODERATOR);
        vi.mocked(findLivePostLink).mockRejectedValue(failure);

        await expect(onStatusForm({ configName: "daily-thread" }, context)).resolves.toStrictEqual({
            showToast: "Could not open that live post. Try again shortly.",
        });
        expect(errorSpy).toHaveBeenCalledExactlyOnceWith(
            "Could not open the live post of thread config daily-thread for u/mod_user:",
            failure,
        );
    });
});
