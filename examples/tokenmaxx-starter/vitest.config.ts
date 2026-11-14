import { defineConfig } from "vitest/config";

// The gate for supplied code: the harness, the environments and every
// exercise's done-check tests. Must stay green.
export default defineConfig({
  test: {
    include: [
      "shared/**/*.test.ts",
      "scripts/**/*.test.ts",
      "exercises/**/*.test.ts",
    ],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
