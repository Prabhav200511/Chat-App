import { defineConfig } from "vitest/config";

export default defineConfig({
    envDir: "tests",
    test: {
        environment: "node",
        include: ["tests/**/*.test.js"],
    },
});
