import { foldkit } from "@foldkit/vite-plugin";
import { defineConfig } from "vite";

export default defineConfig({
  optimizeDeps: {
    exclude: ["@foldkit/devtools", "@foldkit/ui", "foldkit/devtools-host"],
  },
  plugins: [
    foldkit(),
    {
      configResolved: (config) => {
        if (config.optimizeDeps.include !== undefined) {
          config.optimizeDeps.include = config.optimizeDeps.include.filter(
            (specifier) =>
              specifier !== "@foldkit/devtools/vite" &&
              specifier !== "foldkit/devtools-host"
          );
        }
      },
      name: "foldkit-devtools-single-instance",
    },
  ],
  server: { proxy: { "/rpc": "http://foldkit-backend.localhost:1355" } },
});
