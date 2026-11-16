import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Each workspace package's `pnpm test`, run from the package's folder: its
// own tests, which `pnpm check` runs through Turbo. Must stay green. Each
// package keeps its own cache: Turbo runs several at once.
export default defineConfig({
  cacheDir: join(process.cwd(), "node_modules", ".vite"),
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    setupFiles: [fileURLToPath(new URL("vitest.setup.ts", import.meta.url))],
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
