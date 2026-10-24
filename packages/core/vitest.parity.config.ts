import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.parity.ts"],
    testTimeout: 30_000,
  },
});
