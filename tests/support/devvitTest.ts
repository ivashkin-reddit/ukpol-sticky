import { createDevvitTest } from "@devvit/test/server/vitest";

/**
 * Vitest's `it`, with each test run in a fresh in-memory Devvit world (redis, reddit and scheduler).
 * eslint/tests.mjs lists this module in `settings.vitest.vitestImports`, so the vitest lint rules treat it as `it`.
 *
 * WORKAROUND: import this as `{ it as devvitIt }`, not `{ it }`
 *   cause: @vitest/eslint-plugin 1.6.28's prefer-importing-vitest-globals decides "imported from vitest" with
 *          `node.source.value === "vitest"` and ignores settings.vitest.vitestImports, which its other rules honour,
 *          so a bare `it` imported from here is reported (and auto-"fixed" into a duplicate vitest import).
 *   blocked: the check is inside the third-party plugin.
 *   fix: the plugin's prefer-importing-vitest-globals honours settings.vitest.vitestImports.
 *   until: `import { it } from "./support/devvitTest.js"` lints clean in tests/*.integration.test.ts.
 */
export const it = createDevvitTest();
