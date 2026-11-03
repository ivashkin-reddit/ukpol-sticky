import { readdirSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "eslint/config";

// Module boundaries, as AGENTS.md ("Architecture") describes them.

const ROOT = path.resolve(import.meta.dirname, "..");

// The modules under src, in dependency order: each imports only modules before it, and only through their index.ts.
const MODULES = ["./src/platform", "./src/notifications", "./src/configuration", "./src/rotation"];

// Devvit's edge, the files directly under src: main.ts registers the handlers in triggers.ts, which call into the
// modules. No module imports them.
// WORKAROUND: the files directly under src are listed when ESLint loads this config, not matched by "./src/*.ts"
//   cause: no-restricted-paths passes each target through path.resolve before asking is-glob whether it is a glob;
//     on Windows that gives backslashes, which is-glob reads as escapes, so a glob target matches no file there.
//   blocked: the bug is in eslint-plugin-import-x 4.17.1, its latest release.
//   fix: use the target "./src/*.ts" in the interface zones and drop this listing.
//   until: import-x tests for a glob before resolving the target, or matches it with forward slashes.
/** @type {string[]} */
const TOP_LEVEL_FILES = [];
for (const entry of readdirSync(path.join(ROOT, "src"), { withFileTypes: true })) {
    if (entry.isFile()) {
        TOP_LEVEL_FILES.push(`./src/${entry.name}`);
    }
}

// Domain logic: thread configs, schedules and rotation rules as plain values and functions. Callers pass in what it
// needs, so it imports no Devvit package, platform port or moderator alert, and none of its own module's adapters.
const DOMAIN_FILES = [
    "src/configuration/threadConfig.ts",
    "src/configuration/titleTemplate.ts",
    "src/rotation/rotationRules.ts",
];
const DOMAIN_MESSAGE = "Domain files do not depend on infrastructure; pass in what they need instead.";

/** @type {{ target: string | string[]; from: string | string[]; except?: string[]; message: string }[]} */
const zones = [];
for (const [index, modulePath] of MODULES.entries()) {
    zones.push(
        {
            target: [...TOP_LEVEL_FILES, "./tests", ...MODULES.slice(0, index), ...MODULES.slice(index + 1)],
            from: modulePath,
            except: ["./index.ts"],
            message: "Import a module only through its index.ts, which is its interface.",
        },
        {
            target: modulePath,
            from: [...MODULES.slice(index + 1), ...TOP_LEVEL_FILES],
            message: "A module imports only modules before it in the order in eslint/architecture.mjs.",
        },
    );
}
zones.push(
    { target: DOMAIN_FILES, from: ["./src/platform", "./src/notifications"], message: DOMAIN_MESSAGE },
    {
        target: ["src/configuration/threadConfig.ts", "src/configuration/titleTemplate.ts"],
        from: "./src/configuration",
        except: ["./threadConfig.ts", "./titleTemplate.ts"],
        message: DOMAIN_MESSAGE,
    },
    {
        target: "src/rotation/rotationRules.ts",
        from: "./src/rotation",
        except: ["./rotationRules.ts"],
        message: DOMAIN_MESSAGE,
    },
);

export const architecture = defineConfig(
    {
        rules: {
            // Zone paths are relative to the repository root, whichever directory ESLint runs from.
            "import-x/no-restricted-paths": ["error", { basePath: ROOT, zones }],
            // The module order keeps imports between modules one-way; this also covers files within a module.
            "import-x/no-cycle": "error",
        },
    },
    {
        files: DOMAIN_FILES,
        rules: {
            "@typescript-eslint/no-restricted-imports": [
                "error",
                { patterns: [{ group: ["@devvit/*"], message: DOMAIN_MESSAGE }] },
            ],
        },
    },
);
