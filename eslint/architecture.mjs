import path from "node:path";
import { defineConfig } from "eslint/config";
import { createConfig } from "eslint-plugin-boundaries/config";

// Architecture, as AGENTS.md ("Architecture") describes it, enforced by eslint-plugin-boundaries: every file under
// src and tests belongs to an element, and an import between elements is an error unless a policy below allows it.

// The capability modules under src, in dependency order: each may import only modules before it, through their
// index.ts. A new module joins this list.
const MODULE_ORDER = ["notifications", "configuration", "rotation"];

/** @type {import("eslint-plugin-boundaries").ElementDescriptors} */
const ELEMENTS = [
    // Devvit's context types, for adapters and the edge only.
    { type: "platform", pattern: "src/platform", partialMatch: false, exclusive: true },
    // Each module's pure rules, its adapters, and the rest of it: application code, ports and its index.ts.
    { type: "domain", pattern: "src/*/domain", capture: ["module"], partialMatch: false },
    { type: "adapters", pattern: "src/*/adapters", capture: ["module"], partialMatch: false },
    { type: "module", pattern: "src/*", capture: ["module"], partialMatch: false },
    // The files directly under src: main.ts, the trigger handlers, and composition.ts, the only code that builds
    // adapters.
    { type: "edge", pattern: "src", partialMatch: false },
    { type: "tests", pattern: "tests", partialMatch: false },
];

const SAME_MODULE = { module: "{{from.element.captured.module}}" };
const INTERFACE = "index.ts";

/** @type {import("eslint-plugin-boundaries").DependenciesPolicy[]} */
const policies = [
    // Libraries are open to every file; Devvit is closed to domain and application code, below.
    { allow: { to: { module: { origin: ["external", "core"] } } } },
    {
        from: { element: { type: ["domain", "module"] } },
        disallow: { to: { module: { source: "@devvit/*" } } },
        message: "Domain and application code do not depend on Devvit; an adapter does, behind a port.",
    },

    // Domain: its own module's domain files (and libraries other than Devvit).
    { from: { element: { type: "domain" } }, allow: { to: { element: { type: "domain", captured: SAME_MODULE } } } },
    // Application: its own module's domain and application code, never its adapters.
    {
        from: { element: { type: "module" } },
        allow: { to: { element: { type: ["domain", "module"], captured: SAME_MODULE } } },
    },
    // Adapters: their own module's ports, application and domain code, other adapters of it, and Devvit's types.
    {
        from: { element: { type: "adapters" } },
        allow: {
            to: [
                { element: { type: ["adapters", "domain", "module"], captured: SAME_MODULE } },
                { element: { type: "platform" } },
            ],
        },
    },
    // The edge (the composition root): any module's interface and adapters, Devvit's types, and the rest of the edge.
    {
        from: { element: { type: "edge" } },
        allow: {
            to: [
                { element: { type: "module", fileInternalPath: INTERFACE } },
                { element: { type: ["adapters", "edge", "platform"] } },
            ],
        },
    },
];

// Between modules, imports point one way, to the index.ts of a module earlier in MODULE_ORDER. Domain code takes
// only types from them; values reach it as arguments.
for (const [index, moduleName] of MODULE_ORDER.entries()) {
    if (index > 0) {
        const earlierInterfaces = {
            element: {
                type: "module",
                captured: { module: MODULE_ORDER.slice(0, index) },
                fileInternalPath: INTERFACE,
            },
        };
        policies.push(
            {
                from: { element: { type: ["adapters", "module"], captured: { module: moduleName } } },
                allow: { to: earlierInterfaces },
            },
            {
                from: { element: { type: "domain", captured: { module: moduleName } } },
                allow: { to: earlierInterfaces, dependency: { kind: "type" } },
            },
        );
    }
}

policies.push(
    // Production code never imports a test or test support...
    {
        disallow: { to: { file: { categories: "test" } } },
        message: "Production code may not import a test or test support ({{dependency.source}}).",
    },
    // ...while tests reach their own module's internals, other modules through their interfaces and adapters, the
    // edge, Devvit, and the shared test support.
    {
        from: { file: { categories: "test" } },
        allow: {
            to: [
                { element: { captured: SAME_MODULE } },
                { element: { type: "module", fileInternalPath: INTERFACE } },
                { element: { type: ["adapters", "edge", "platform", "tests"] } },
                { module: { origin: ["external", "core"] } },
            ],
        },
    },
);

const ARCHITECTURE_FILES = ["src/**/*.ts", "tests/**/*.ts"];

export const architecture = defineConfig(
    {
        rules: {
            // The module order keeps imports between modules one-way; this also covers files within a module.
            "import-x/no-cycle": "error",
        },
    },
    {
        files: ARCHITECTURE_FILES,
        // eslint-plugin-boundaries resolves imports through eslint-module-utils, which reads this legacy setting.
        settings: { "import/resolver": { typescript: true } },
    },
    // createConfig registers the plugin, and accepts only its own settings and rules.
    createConfig({
        files: ARCHITECTURE_FILES,
        settings: {
            "boundaries/root-path": path.resolve(import.meta.dirname, ".."),
            "boundaries/elements": ELEMENTS,
            "boundaries/files": [
                { pattern: "**/*.test.ts", category: "test" },
                { pattern: "tests/**", category: "test" },
            ],
        },
        rules: {
            "boundaries/dependencies": [
                "error",
                {
                    checkAllOrigins: true,
                    // Also check imports between files of one element, so production code cannot import a
                    // co-located test.
                    checkInternals: true,
                    default: "disallow",
                    message:
                        "{{from.element.types.[0]}} code may not import {{dependency.source}} ({{to.element.types.[0]}}); see Architecture in AGENTS.md.",
                    policies,
                },
            ],
            "boundaries/no-ignored-dependencies": "error",
            "boundaries/no-unknown-dependencies": "error",
            "boundaries/no-unknown-files": "error",
        },
    }),
);
