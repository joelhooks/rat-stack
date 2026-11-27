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
          include: [
            "test/all-stars-effect-ui.test.ts",
            "test/app.test.ts",
            "test/directory-effect-ui.test.ts",
            "test/news-effect-ui.test.ts",
            "test/overlay.test.ts",
            "test/reader-csp.test.ts",
            "test/reader-effect-ui.test.ts",
          ],
          name: "browser",
        },
      },
      {
        extends: true,
        test: {
          environment: "node",
          exclude: [
            "test/all-stars-effect-ui.test.ts",
            "test/app.test.ts",
            "test/directory-effect-ui.test.ts",
            "test/news-effect-ui.test.ts",
            "test/overlay.test.ts",
            "test/reader-csp.test.ts",
            "test/reader-effect-ui.test.ts",
          ],
          include: ["test/**/*.test.ts"],
          name: "server",
        },
      },
    ],
  },
});
