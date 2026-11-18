import { defineConfig } from "vitest/config";

import { runtimeTestPattern } from "./vitest.runtime-suite.js";

export default defineConfig({
  test: {
    exclude: [runtimeTestPattern, "**/node_modules/**", "**/.git/**"],
    hookTimeout: 30_000,
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
