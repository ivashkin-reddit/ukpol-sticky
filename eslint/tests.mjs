import vitest from "@vitest/eslint-plugin";
import { defineConfig } from "eslint/config";

// vitest.configs.all sets every rule to "warn"; here every vitest rule is an error.
/** @type {Record<string, "error">} */
const vitestRulesAsErrors = {};
for (const rule of Object.keys(vitest.configs.all.rules)) {
    vitestRulesAsErrors[rule] = "error";
}

export const tests = defineConfig({
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
        // Conflicts: prefer-strict-boolean-matchers requires toBe(true) / toBe(false), which also rejects truthy
        // non-booleans; these two require toBeTruthy() / toBeFalsy().
        "vitest/prefer-to-be-falsy": "off",
        "vitest/prefer-to-be-truthy": "off",
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
});
