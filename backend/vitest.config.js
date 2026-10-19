import { defineConfig } from "vitest/config";

export default defineConfig({
    // Vite's loadEnv scans the project root for .env files at startup.
    // backend/.env is an unreadable OneDrive cloud placeholder on this
    // machine (readSync -> EUNKNOWN), and tests must never see dev secrets
    // anyway — so point env resolution at tests/, which has no .env files.
    // The suite configures process.env itself in tests/setup.js.
    envDir: "tests",
    test: {
        environment: "node",
        include: ["tests/**/*.test.js"],
        globalSetup: ["tests/globalSetup.js"],
        setupFiles: ["tests/setup.js"],
        // Sequential file execution (no two suites writing to the shared test
        // DB at once), but a FRESH fork per file: mongoose is an externalized
        // native dependency, so a reused process would keep its compiled models
        // while the source registry re-executes -> OverwriteModelError.
        pool: "forks",
        fileParallelism: false,
        testTimeout: 30000,
        hookTimeout: 120000,
    },
});
