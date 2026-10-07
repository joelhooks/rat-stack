import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: { EVENTS_SINK_TOKEN: "test-token" },
    include: ["test/**/*.test.ts"],
    maxWorkers: 1,
  },
});
