import eslint from "@eslint/js";
import { recommended as eslintCommentsRecommended } from "@eslint-community/eslint-plugin-eslint-comments/configs";
import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";
import prettierCompatible from "eslint-config-prettier/flat";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import { importX } from "eslint-plugin-import-x";
import { configs as regexpConfigs } from "eslint-plugin-regexp";
import { configs as typescriptEslintConfigs } from "typescript-eslint";

// vitest.configs.all sets every rule to "warn"; here every vitest rule is an error.
/** @type {Record<string, "error">} */
const vitestRulesAsErrors = {};
for (const rule of Object.keys(vitest.configs.all.rules)) {
    vitestRulesAsErrors[rule] = "error";
}

export default defineConfig(
    {
        ignores: ["**/node_modules", "**/dist"],
    },
    {
        linterOptions: {
            reportUnusedDisableDirectives: "error",
            reportUnusedInlineConfigs: "error",
        },
    },

    // Every rule from each source, then the typed presets on top so their stricter options win.
    eslint.configs.all,
    typescriptEslintConfigs.all,
    typescriptEslintConfigs.strictTypeChecked,
    typescriptEslintConfigs.stylisticTypeChecked,
    importX.flatConfigs.recommended,
    importX.flatConfigs.typescript,
    regexpConfigs.all,
    eslintCommentsRecommended,

    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    // This file runs on Node rather than in Devvit, so it is typed by tsconfig.node.json.
                    allowDefaultProject: ["eslint.config.mjs"],
                    defaultProject: "tsconfig.node.json",
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
        settings: {
            "import-x/resolver-next": [createTypeScriptImportResolver()],
        },
        rules: {
            // Core rules, stricter options.
            "eqeqeq": ["error", "always", { null: "ignore" }],
            "curly": ["error", "all"],
            "camelcase": ["error", { properties: "always" }],
            "arrow-body-style": ["error", "as-needed"],
            "func-style": ["error", "declaration", { allowArrowFunctions: true }],
            "object-shorthand": ["error", "always"],
            "operator-assignment": ["error", "always"],
            "logical-assignment-operators": ["error", "always", { enforceForIfStatements: true }],
            "no-else-return": ["error", { allowElseIf: false }],
            // verbatimModuleSyntax needs value and type imports from one module as separate statements.
            "no-duplicate-imports": ["error", { allowSeparateTypeImports: true, includeExports: true }],
            // Names this code chooses; property names are often fixed by an external API (json2md's `p`).
            "id-length": ["error", { properties: "never" }],

            // Rules from eslint.configs.all that are off, each for one stated reason.
            // Conflicts: switch-exhaustiveness-check forbids a default branch on an exhaustive union switch,
            // so adding a union member becomes a type error instead of falling into `default`.
            "default-case": "off",
            // Conflicts: consistent-return and noImplicitReturns require writing `return undefined` explicitly.
            "no-undefined": "off",
            // Conflicts: import-x/order owns import ordering.
            "sort-imports": "off",
            // Conflicts: eqeqeq allows `== null` deliberately; it matches exactly null and undefined, and optional
            // config fields can hold null because ajv's JSONSchemaType admits null for optional properties.
            "no-eq-null": "off",
            // Conflicts: the WORKAROUND block format has fixed lowercase labels, and comments often begin with a
            // code identifier whose case is meaningful; the autofix rewrites both.
            "capitalized-comments": "off",
            // Duplicates: regexp/prefer-named-capture-group and regexp/require-unicode-regexp report the same thing.
            "prefer-named-capture-group": "off",
            "require-unicode-regexp": "off",
            // Platform: console is Devvit's logging channel (`devvit logs` streams it).
            "no-console": "off",
            // Taste, with an equally valid opposite and no correctness value: grouping declarations, ordering
            // object keys (schema keys follow the Config interface), and banning ternaries.
            "one-var": "off",
            "sort-keys": "off",
            "no-ternary": "off",
            // Platform: the `v` flag needs ES2024; Devvit's shared tsconfig and its esbuild bundle target ES2020.
            "regexp/require-unicode-sets-regexp": "off",

            // typescript-eslint, stricter options.
            "@typescript-eslint/strict-boolean-expressions": [
                "error",
                {
                    allowAny: false,
                    allowNullableBoolean: false,
                    allowNullableEnum: false,
                    allowNullableNumber: false,
                    allowNullableObject: false,
                    allowNullableString: false,
                    allowNumber: false,
                    allowString: false,
                },
            ],
            "@typescript-eslint/switch-exhaustiveness-check": [
                "error",
                {
                    allowDefaultCaseForExhaustiveSwitch: false,
                    considerDefaultExhaustiveForUnions: false,
                    requireDefaultForNonUnion: true,
                },
            ],
            "@typescript-eslint/explicit-function-return-type": [
                "error",
                {
                    allowConciseArrowFunctionExpressionsStartingWithVoid: false,
                    allowDirectConstAssertionInArrowFunctions: false,
                    allowExpressions: false,
                    allowFunctionsWithoutTypeParameters: false,
                    allowHigherOrderFunctions: false,
                    allowIIFEs: false,
                    allowTypedFunctionExpressions: false,
                },
            ],
            "@typescript-eslint/consistent-type-imports": [
                "error",
                {
                    disallowTypeAnnotations: true,
                    fixStyle: "separate-type-imports",
                    prefer: "type-imports",
                },
            ],
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "default", format: ["camelCase"], leadingUnderscore: "allow", trailingUnderscore: "allow" },
                { selector: "import", format: ["camelCase", "PascalCase"] },
                {
                    selector: "variable",
                    format: ["camelCase", "UPPER_CASE"],
                    leadingUnderscore: "allow",
                    trailingUnderscore: "allow",
                },
                { selector: "typeLike", format: ["PascalCase"] },
                // Quoted keys are data (Redis field names, ESLint rule names), not identifiers (per the rule's docs).
                {
                    selector: ["objectLiteralProperty", "objectLiteralMethod"],
                    modifiers: ["requiresQuotes"],
                    format: null,
                },
            ],
            "@typescript-eslint/return-await": ["error", "always"],
            "@typescript-eslint/no-floating-promises": [
                "error",
                { checkThenables: true, ignoreIIFE: false, ignoreVoid: false },
            ],
            "@typescript-eslint/no-unnecessary-condition": [
                "error",
                { allowConstantLoopConditions: "never", checkTypePredicates: true },
            ],
            "@typescript-eslint/require-array-sort-compare": ["error", { ignoreStringArrays: false }],
            "@typescript-eslint/no-shadow": [
                "error",
                {
                    builtinGlobals: true,
                    hoist: "all",
                    ignoreFunctionTypeParameterNameValueShadow: false,
                    ignoreTypeValueShadow: false,
                },
            ],
            // -1, 0 and 1 are comparator results, offsets and emptiness checks, not domain values.
            "@typescript-eslint/no-magic-numbers": [
                "error",
                {
                    detectObjects: true,
                    enforceConst: true,
                    ignore: [-1, 0, 1],
                    ignoreArrayIndexes: false,
                    ignoreEnums: false,
                    ignoreNumericLiteralTypes: false,
                    ignoreReadonlyClassProperties: false,
                    ignoreTypeIndexes: false,
                },
            ],
            "@typescript-eslint/prefer-readonly-parameter-types": [
                "error",
                {
                    // WORKAROUND: Date parameters count as readonly
                    //   cause: Date is a mutable built-in (setHours and friends), so no Date parameter can be deeply readonly.
                    //   blocked: the immutable replacement, Temporal, is not in Devvit's ES2020 runtime or its TypeScript lib.
                    //   fix: carry instants as Temporal.Instant instead of Date.
                    //   until: Devvit's runtime and tsconfig lib include Temporal.
                    allow: [{ from: "lib", name: "Date" }],
                    checkParameterProperties: true,
                    ignoreInferredTypes: false,
                    treatMethodsAsReadonly: false,
                },
            ],

            // Every suppression is a single next-line directive with a written reason.
            "@eslint-community/eslint-comments/require-description": ["error", { ignore: [] }],
            "@eslint-community/eslint-comments/no-unlimited-disable": "error",
            "@eslint-community/eslint-comments/no-use": ["error", { allow: ["eslint-disable-next-line"] }],

            // Imports. The first three are warnings in import-x's recommended config.
            "import-x/no-duplicates": "error",
            "import-x/no-named-as-default": "error",
            "import-x/no-named-as-default-member": "error",
            "import-x/no-extraneous-dependencies": [
                "error",
                {
                    devDependencies: ["**/*.test.ts", "tests/**", "vitest.config.ts", "eslint.config.mjs"],
                    includeInternal: true,
                    includeTypes: true,
                },
            ],
            "import-x/no-cycle": "error",
            "import-x/no-self-import": "error",
            "import-x/no-useless-path-segments": "error",
            "import-x/no-relative-packages": "error",
            "import-x/no-mutable-exports": "error",
            "import-x/no-named-default": "error",
            "import-x/no-empty-named-blocks": "error",
            "import-x/no-anonymous-default-export": "error",
            "import-x/no-default-export": "error",
            "import-x/consistent-type-specifier-style": ["error", "prefer-top-level"],
            "import-x/first": "error",
            "import-x/newline-after-import": "error",
            "import-x/order": ["error", { "alphabetize": { order: "asc" }, "newlines-between": "never" }],
        },
    },

    {
        files: ["**/*.test.ts"],
        plugins: { vitest },
        settings: {
            vitest: {
                // Lets rules such as valid-title use type information (e.g. to accept describe(someFunction, ...)).
                typecheck: true,
                // tests/support/devvitTest.ts re-exports Devvit's harness-backed `it`; vitest rules treat it as vitest's.
                vitestImports: [/\/support\/devvitTest\.js$/u],
            },
        },
        rules: {
            ...vitestRulesAsErrors,
            // Conflicts: prefer-importing-vitest-globals is on; tests import from "vitest" explicitly.
            "vitest/no-importing-vitest-globals": "off",
            // Replaced in tests by vitest/unbound-method, which understands expect(mock.method) (per @vitest/eslint-plugin docs).
            "@typescript-eslint/unbound-method": "off",
            // Literal expected values are the content of a test; naming each one hides what is asserted.
            "@typescript-eslint/no-magic-numbers": "off",
            // Conflicts: require-top-level-describe puts every test of a file inside one describe callback.
            "max-lines-per-function": "off",
            "max-statements": "off",
        },
    },

    {
        // Devvit loads the module named by `blocks.entry` in devvit.json through its default export.
        files: ["src/main.ts"],
        rules: {
            "import-x/no-default-export": "off",
        },
    },
    {
        // ESLint and Vitest load their config files through the default export.
        files: ["eslint.config.mjs", "vitest.config.ts"],
        rules: {
            "import-x/no-default-export": "off",
        },
    },
    {
        files: ["vitest.config.ts"],
        rules: {
            // Environment variable names (`TZ`) are UPPER_CASE by convention.
            "@typescript-eslint/naming-convention": [
                "error",
                { selector: "default", format: ["camelCase"] },
                { selector: "import", format: ["camelCase", "PascalCase"] },
                { selector: "objectLiteralProperty", format: ["camelCase", "UPPER_CASE"] },
            ],
        },
    },

    // Prettier owns formatting (npm run format); this turns off every rule that would disagree with its output.
    prettierCompatible,
    {
        rules: {
            // eslint-config-prettier switches off two "special rules" that stay compatible with Prettier as used here:
            // curly "all" never conflicts (only its "multi-line" and "multi-or-nest" options do), and
            // no-unexpected-multiline catches automatic-semicolon-insertion hazards.
            "curly": ["error", "all"],
            "no-unexpected-multiline": "error",
        },
    },
);
