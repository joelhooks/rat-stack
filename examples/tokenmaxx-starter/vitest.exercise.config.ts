import { defineConfig } from "vitest/config";

// Used by `pnpm ex <id> test`, which passes one exercise folder as the filter:
// the done check's own tests.
export default defineConfig({
  test: {
    include: ["exercises/**/*.test.ts"],
    passWithNoTests: true,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
