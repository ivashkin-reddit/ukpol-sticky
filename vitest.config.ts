import { defineConfig } from "vitest/config";

export default defineConfig({
    test: {
        // Devvit runs in UTC; date formatting in tests must not depend on the machine's time zone.
        env: { TZ: "UTC" },
        // Tests import describe, it, expect and vi from "vitest".
        globals: false,
        // Every test starts with fresh mocks, spies, env and globals, so tests need no cleanup hooks.
        mockReset: true,
        restoreMocks: true,
        unstubEnvs: true,
        unstubGlobals: true,
        // Random order exposes a test that depends on what another test left behind.
        sequence: { shuffle: true },
    },
});
