import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { DevvitContext } from "../src/composition.js";
import { REFRESH_CHECK_JOB_NAME, REFRESH_JOB_NAME } from "../src/rotation/adapters/schedulerRefreshJobs.js";
import { createApp } from "../src/server/app.js";
import type {
    onAppInstall,
    onAppUpgrade,
    onCommentCreate,
    onModAction,
    onPostDelete,
    onRefreshCheck,
    onRefreshJob,
} from "../src/triggers.js";
import type * as Triggers from "../src/triggers.js";
import { createFakeDevvitContext } from "./support/fakeDevvitContext.js";

vi.mock(import("../src/triggers.js"), (): Partial<typeof Triggers> => ({
    onAppInstall: vi.fn<typeof onAppInstall>(),
    onAppUpgrade: vi.fn<typeof onAppUpgrade>(),
    onCommentCreate: vi.fn<typeof onCommentCreate>(),
    onModAction: vi.fn<typeof onModAction>(),
    onPostDelete: vi.fn<typeof onPostDelete>(),
    onRefreshCheck: vi.fn<typeof onRefreshCheck>(),
    onRefreshJob: vi.fn<typeof onRefreshJob>(),
}));

// Unit tests run in milliseconds; a second is far beyond any legitimate run.
const TEST_OPTIONS = { timeout: 1000 };

const DEVVIT_CONFIG: unknown = JSON.parse(readFileSync(new URL("../devvit.json", import.meta.url), "utf8"));

// devvit.json in full. Any change to it, a widened permission above all, fails here until this is changed to match.
const EXPECTED_CONFIG = {
    $schema: "https://developers.reddit.com/schema/config-file.v1.json",
    name: "ukpol-megabot",
    server: { dir: "dist/server", entry: "index.cjs" },
    triggers: {
        onModAction: "/internal/triggers/mod-action",
        onCommentCreate: "/internal/triggers/comment-create",
        onPostDelete: "/internal/triggers/post-delete",
        onAppInstall: "/internal/triggers/app-install",
        onAppUpgrade: "/internal/triggers/app-upgrade",
    },
    // Keyed by the job names the app schedules, so devvit.json and the scheduler adapter cannot drift apart.
    scheduler: {
        tasks: {
            [REFRESH_JOB_NAME]: "/internal/jobs/refresh",
            [REFRESH_CHECK_JOB_NAME]: "/internal/jobs/refresh-check",
        },
    },
    permissions: { http: { enable: false }, redis: true, reddit: { enable: true, scope: "user" } },
    scripts: { build: "vite build", dev: "vite build --watch" },
    dev: { subreddit: "ukpol_megabot_dev" },
};

const DECLARED_ENDPOINTS = [
    ...Object.values(EXPECTED_CONFIG.triggers),
    ...Object.values(EXPECTED_CONFIG.scheduler.tasks),
];

describe("devvit.json", (): void => {
    it(
        "grants only the permissions the app uses, with no web view, outbound HTTP or outside endpoint",
        TEST_OPTIONS,
        (): void => {
            expect.assertions(1);

            expect(DEVVIT_CONFIG).toStrictEqual(EXPECTED_CONFIG);
        },
    );

    it.for(DECLARED_ENDPOINTS)(
        "declares %s, which the server serves",
        TEST_OPTIONS,
        async (endpoint: string): Promise<void> => {
            expect.assertions(1);

            const { context } = createFakeDevvitContext();
            const response = await createApp((): DevvitContext => context).request(endpoint, {
                method: "POST",
                body: "{}",
            });

            expect(response.status).toBe(200);
        },
    );
});
