import { ESLint } from "eslint";
import { describe, expect, it } from "vitest";

// Lints imports that break the architecture, and imports it must keep allowing, through the project's own ESLint
// config. A dependency upgrade or config change that stops a boundary rule from firing fails here rather than
// passing lint silently. Only the architecture rules run, without type information.

// Loading the full ESLint config (every plugin) takes seconds on a cold start; each case after that takes milliseconds.
const TEST_OPTIONS = { timeout: 30_000 };

const ARCHITECTURE_RULES = new Set([
    "boundaries/dependencies",
    "boundaries/no-ignored-dependencies",
    "boundaries/no-unknown-dependencies",
    "boundaries/no-unknown-files",
    "import-x/no-cycle",
]);

const eslint = new ESLint({
    overrideConfig: { languageOptions: { parserOptions: { projectService: false } } },
    ruleFilter: ({ ruleId }: Readonly<{ ruleId: string }>): boolean => ARCHITECTURE_RULES.has(ruleId),
});

interface ImportCase {
    readonly rule: string;
    readonly file: string;
    readonly source: string;
}

/** The architecture rules that report `source`, linted as if it were the content of `file`. */
async function architectureFindings(importCase: ImportCase): Promise<string[]> {
    const results = await eslint.lintText(importCase.source, { filePath: importCase.file });
    const ruleIds: string[] = [];
    for (const result of results) {
        for (const message of result.messages) {
            if (message.ruleId !== null) {
                ruleIds.push(message.ruleId);
            }
        }
    }

    return ruleIds;
}

const FORBIDDEN_IMPORTS: readonly ImportCase[] = [
    {
        rule: "application code does not import its module's adapters",
        file: "src/rotation/rotation.ts",
        source: 'export { redisLivePosts } from "./adapters/redisLivePosts.js";',
    },
    {
        rule: "application code does not import Devvit's context types",
        file: "src/rotation/rotation.ts",
        source: 'export type { RedisPort } from "../platform/index.js";',
    },
    {
        rule: "application code does not import Devvit",
        file: "src/rotation/rotation.ts",
        source: 'export type { RedisClient } from "@devvit/web/server";',
    },
    {
        rule: "domain code does not import Devvit",
        file: "src/rotation/domain/rotationRules.ts",
        source: 'export type { RedisClient } from "@devvit/web/server";',
    },
    {
        rule: "domain code does not import its module's application code",
        file: "src/rotation/domain/rotationRules.ts",
        source: 'export type { LivePosts } from "../ports.js";',
    },
    {
        rule: "domain code takes only types from other modules",
        file: "src/rotation/domain/rotationRules.ts",
        source: 'export { getSchedule } from "../../configuration/index.js";',
    },
    {
        rule: "a module does not import a module after it",
        file: "src/configuration/storedConfigs.ts",
        source: 'export { requestRefresh } from "../rotation/index.js";',
    },
    {
        rule: "notifications does not import the managed threads modules",
        file: "src/notifications/index.ts",
        source: 'export type { ThreadConfig } from "../configuration/index.js";',
    },
    {
        rule: "modules import each other only through index.ts",
        file: "src/rotation/rotation.ts",
        source: 'export { getThreadConfigs } from "../configuration/storedConfigs.js";',
    },
    {
        rule: "a module's interface does not expose its adapters",
        file: "src/rotation/index.ts",
        source: 'export { redisLivePosts } from "./adapters/redisLivePosts.js";',
    },
    {
        rule: "the edge imports modules only through index.ts",
        file: "src/triggers.ts",
        source: 'export { refreshAllThreads } from "./rotation/rotation.js";',
    },
    {
        rule: "an adapter does not import another module's adapters",
        file: "src/rotation/adapters/redditPosts.ts",
        source: 'export { redisConfigStore } from "../../configuration/adapters/redisConfigStore.js";',
    },
    {
        rule: "Devvit's context types import no module",
        file: "src/platform/index.ts",
        source: 'export type { ModeratorAlert } from "../notifications/index.js";',
    },
    {
        rule: "modules do not import the edge",
        file: "src/rotation/rotation.ts",
        source: 'export { rotationPorts } from "../composition.js";',
    },
    {
        rule: "production code does not import test support",
        file: "src/rotation/rotation.ts",
        source: 'export { freezeTime } from "../../tests/support/fakeClock.js";',
    },
    {
        rule: "production code does not import a co-located test",
        file: "src/rotation/rotation.ts",
        source: 'export * from "./rotation.test.js";',
    },
    {
        rule: "modules do not import the server",
        file: "src/rotation/rotation.ts",
        source: 'export { isJsonObject } from "../server/requestBodies.js";',
    },
    {
        rule: "the server imports modules only through index.ts",
        file: "src/server/requestBodies.ts",
        source: 'export { refreshAllThreads } from "../rotation/rotation.js";',
    },
    {
        rule: "tests reach other modules only through their interfaces and adapters",
        file: "tests/support/defer.ts",
        source: 'export { storeThreadConfigs } from "../../src/configuration/storedConfigs.js";',
    },
];

const ALLOWED_IMPORTS: readonly ImportCase[] = [
    {
        rule: "domain code takes types from an earlier module",
        file: "src/rotation/domain/rotationRules.ts",
        source: 'export type { ThreadConfig } from "../../configuration/index.js";',
    },
    {
        rule: "application code imports an earlier module's interface",
        file: "src/rotation/rotation.ts",
        source: 'export { getThreadConfigs } from "../configuration/index.js";',
    },
    {
        rule: "application code imports its module's ports",
        file: "src/rotation/rotation.ts",
        source: 'export type { LivePosts } from "./ports.js";',
    },
    {
        rule: "an adapter imports Devvit's context types",
        file: "src/rotation/adapters/redditPosts.ts",
        source: 'export type { RedisPort } from "../../platform/index.js";',
    },
    {
        rule: "the composition root builds adapters",
        file: "src/composition.ts",
        source: 'export { redisLivePosts } from "./rotation/adapters/redisLivePosts.js";',
    },
    {
        rule: "the server imports the trigger handlers' event types",
        file: "src/server/requestBodies.ts",
        source: 'export type { ModActionEvent } from "../triggers.js";',
    },
    {
        rule: "the server imports Devvit",
        file: "src/server/requestBodies.ts",
        source: 'export type { OnModActionRequest } from "@devvit/web/shared";',
    },
    {
        rule: "a test imports test support",
        file: "src/rotation/rotation.test.ts",
        source: 'export { createFakeRotationPorts } from "../../tests/support/fakeRotationPorts.js";',
    },
];

describe("architecture rules", (): void => {
    it.for(FORBIDDEN_IMPORTS)("report that $rule", TEST_OPTIONS, async (importCase: ImportCase): Promise<void> => {
        expect.assertions(1);

        await expect(architectureFindings(importCase)).resolves.toContain("boundaries/dependencies");
    });

    it.for(ALLOWED_IMPORTS)("allow that $rule", TEST_OPTIONS, async (importCase: ImportCase): Promise<void> => {
        expect.assertions(1);

        await expect(architectureFindings(importCase)).resolves.toStrictEqual([]);
    });
});
