import { Buffer } from "node:buffer";

import { foldkit } from "@foldkit/vite-plugin";
import { Predicate, Schema } from "effect";
import { defineConfig } from "vite";

import { readerFinalizationPlugin } from "./reader-finalization.js";
import { readerPagesPlugin } from "./reader-pages.js";
import { readerPrerenderOrigin } from "./src/server/prerender-origin.js";
import type { BackendFetch } from "./src/server/rpc.js";
import { stylexPlugin } from "./stylex.js";

export default defineConfig(({ isSsrBuild }) => ({
  build: {
    outDir: "dist/client",
    rolldownOptions: { external: [/^cloudflare:/u] },
  },
  optimizeDeps: {
    exclude: ["@foldkit/devtools", "@foldkit/ui", "foldkit/devtools-host"],
  },
  plugins: [
    stylexPlugin(),
    readerPagesPlugin(),
    foldkit(
      isSsrBuild === true
        ? {}
        : {
            ssr: {
              build: {
                clientOutDir: "dist/client",
                prerender: { origin: readerPrerenderOrigin },
                serverOutDir: "dist/server",
              },
              clientEntry: "/src/client/entry.ts",
              serverEntry: "/src/entry.server.ts",
            },
          }
    ),
    ...(isSsrBuild === true ? [] : [readerFinalizationPlugin()]),
    {
      apply: "build",
      config: (config, environment) => {
        const clientOutDir = config.build?.outDir ?? "dist/client";

        return environment.isSsrBuild === true
          ? {}
          : {
              environments: {
                client: { build: { outDir: clientOutDir } },
                ssr: {
                  build: {
                    outDir:
                      clientOutDir === "dist/client"
                        ? "dist/server"
                        : `${clientOutDir}/server`,
                  },
                },
              },
            };
      },
      name: "reader-output-layout",
    },
    {
      configureServer: (server) => {
        server.middlewares.use((incoming, outgoing, next) => {
          const { pathname } = new URL(incoming.url ?? "/", "http://dev.test");

          if (
            pathname !== "/rpc" &&
            !pathname.startsWith("/rpc/") &&
            pathname !== "/__rat" &&
            !pathname.startsWith("/__rat/")
          ) {
            next();

            return;
          }

          // @effect-diagnostics-next-line asyncFunction:off -- Connect middleware and Vite's module loader use Promises.
          const respond = async () => {
            let response: Response;

            try {
              const { backend } = Schema.decodeUnknownSync(
                Schema.Struct({
                  backend: Schema.declare<BackendFetch>(
                    (input): input is BackendFetch =>
                      Predicate.isFunction(input)
                  ),
                })
              )(await server.ssrLoadModule("#backend"));

              const chunks: Uint8Array[] = [];

              for await (const chunk of incoming) {
                chunks.push(Schema.decodeUnknownSync(Schema.Uint8Array)(chunk));
              }

              const body = Uint8Array.from(Buffer.concat(chunks));

              const headers = new Headers();

              for (const [name, value] of Object.entries(incoming.headers)) {
                if (value !== undefined) {
                  headers.set(
                    name,
                    Array.isArray(value) ? value.join(", ") : value
                  );
                }
              }

              const options: RequestInit & { duplex: "half" } = {
                body:
                  incoming.method === "GET" || incoming.method === "HEAD"
                    ? null
                    : body,
                duplex: "half",
                headers,
                method: incoming.method ?? "GET",
              };

              response = await backend(
                new Request(
                  `http://${incoming.headers.host ?? "dev.test"}${incoming.url}`,
                  options
                )
              );
            } catch (error) {
              next(error);

              return;
            }

            outgoing.writeHead(
              response.status,
              Object.fromEntries(response.headers)
            );
            outgoing.end(new Uint8Array(await response.arrayBuffer()));
          };

          void respond();
        });
      },
      name: "rat-content-backend",
    },
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
}));
