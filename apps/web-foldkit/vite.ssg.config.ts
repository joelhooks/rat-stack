import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    foldkit({
      ssr: {
        build: {
          clientOutDir: "dist/ssg/client",
          prerender: { origin: "https://example.test" },
          serverOutDir: "dist/ssg/server",
        },
        serverEntry: "/src/entry.server.ts",
      },
    }),
  ],
});
