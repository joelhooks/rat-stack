import { defineConfig } from "vitest/config";

import { runtimeTestPattern } from "./vitest.runtime-suite.js";

export default defineConfig({
  test: {
    hookTimeout: 30_000,
    include: [runtimeTestPattern],
    maxWorkers: 1,
    testTimeout: 30_000,
  },
});
