import { Buffer } from "node:buffer";

import { foldkit } from "@foldkit/vite-plugin";
import { Predicate, Schema } from "effect";
import { createServer, defineConfig } from "vite";

import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  ratSvg,
} from "../mischief/src/rat-icons.generated.js";
import type { BackendFetch } from "./src/server/rpc.js";
import { stylexPlugin, stylexRenderingPlugin } from "./stylex.js";

type StaticRenderer = () => Promise<{ readonly html: string }>;

export default defineConfig({
  build: { rolldownOptions: { external: ["cloudflare:workers"] } },
  optimizeDeps: {
    exclude: ["@foldkit/devtools", "@foldkit/ui", "foldkit/devtools-host"],
  },
  plugins: [
    {
      name: "rat-icons",
      transformIndexHtml: () => [
        {
          attrs: {
            href: `data:image/x-icon;base64,${faviconIcoBase64}`,
            rel: "icon",
            sizes: "48x48",
          },
          injectTo: "head",
          tag: "link",
        },
        {
          attrs: {
            href: `data:image/svg+xml,${encodeURIComponent(ratSvg)}`,
            rel: "icon",
            type: "image/svg+xml",
          },
          injectTo: "head",
          tag: "link",
        },
        {
          attrs: {
            href: `data:image/png;base64,${appleTouchIconPngBase64}`,
            rel: "apple-touch-icon",
          },
          injectTo: "head",
          tag: "link",
        },
      ],
    },
    stylexPlugin(),
    foldkit(),
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
      apply: (_config, environment) =>
        environment.command === "build" && environment.isSsrBuild !== true,
      generateBundle: {
        // @effect-diagnostics-next-line asyncFunction:off -- Rollup awaits build-only prerendering before emitting the static asset.
        async handler(_options, bundle) {
          const home = bundle["index.html"];

          if (home?.type !== "asset") {
            throw new Error("Build the home HTML before the featured route.");
          }

          const source = Schema.decodeUnknownSync(Schema.String)(home.source);

          const renderer = await createServer({
            configFile: false,
            plugins: [stylexRenderingPlugin()],
            server: { hmr: false, middlewareMode: true, ws: false },
          });

          try {
            const { renderFeatured } = Schema.decodeUnknownSync(
              Schema.Struct({
                renderFeatured: Schema.declare<StaticRenderer>(
                  (input): input is StaticRenderer =>
                    Predicate.isFunction(input)
                ),
              })
            )(await renderer.ssrLoadModule("/src/entry.server.ts"));

            const rendered = Schema.decodeUnknownSync(
              Schema.Struct({ html: Schema.String })
            )(await renderFeatured());

            this.emitFile({
              fileName: "featured/index.html",
              source: source
                .replace(
                  /<div id="root">[\s\S]*<\/div>/u,
                  `<div id="root">${rendered.html}</div>`
                )
                .replace(
                  "<title>rat-stack docs</title>",
                  "<title>Featured sites | rat-stack</title>"
                ),
              type: "asset",
            });
          } finally {
            await renderer.close();
          }
        },
        order: "post",
      },
      name: "rat-static-home",
      transformIndexHtml: {
        // @effect-diagnostics-next-line asyncFunction:off -- Vite awaits the static HTML transform at build time.
        handler: async (html) => {
          const renderer = await createServer({
            configFile: false,
            plugins: [stylexRenderingPlugin()],
            server: { hmr: false, middlewareMode: true, ws: false },
          });

          try {
            const { renderHome } = Schema.decodeUnknownSync(
              Schema.Struct({
                renderHome: Schema.declare<StaticRenderer>(
                  (input): input is StaticRenderer =>
                    Predicate.isFunction(input)
                ),
              })
            )(await renderer.ssrLoadModule("/src/entry.server.ts"));

            const rendered = Schema.decodeUnknownSync(
              Schema.Struct({ html: Schema.String })
            )(await renderHome());

            return html.replace(
              '<div id="root"></div>',
              `<div id="root">${rendered.html}</div>`
            );
          } finally {
            await renderer.close();
          }
        },
        order: "post",
      },
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
});
