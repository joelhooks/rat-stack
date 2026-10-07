import { defineConfig } from "vitest/config";

import { stylexRenderingPlugin } from "./stylex.js";

export default defineConfig({
  plugins: [stylexRenderingPlugin()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          environment: "jsdom",
          include: ["test/app.test.ts", "test/overlay.test.ts"],
          name: "browser",
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          exclude: ["test/app.test.ts", "test/overlay.test.ts"],
          include: ["test/**/*.test.ts"],
          name: "server",
        },
      },
    ],
  },
});
