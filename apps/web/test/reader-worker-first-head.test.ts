import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import { AssetBindingSchema } from "../../mischief/src/static-assets.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { isWorkerFirstReaderRoute } from "../src/reader-routes.js";

const BuiltEntry = Schema.Struct({ default: AssetBindingSchema });

// @effect-diagnostics-next-line asyncFunction:off -- The built server entry loads through a dynamic import Promise.
const builtEntry = async () =>
  Schema.decodeUnknownSync(BuiltEntry)(
    await import(new URL("../dist/server/fetch.js", import.meta.url).href)
  );

const voidTagsAsParsed = (html: string) => html.replaceAll(" />", ">");

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "a worker-first reader page answers with its prerendered head and body",
    () =>
      Effect.gen(function* workerFirstHeads() {
        const fs = yield* FileSystem.FileSystem;
        const dist = new URL("../dist/", import.meta.url).pathname;

        const pages = yield* fs
          .readFileString(`${dist}reader-pages.json`)
          .pipe(
            Effect.flatMap(
              Schema.decodeUnknownEffect(
                Schema.fromJsonString(Schema.Array(ReaderFlags))
              )
            )
          );

        const { default: worker } = yield* Effect.promise(builtEntry);

        const routes = pages
          .map((page) => page.page.path)
          .filter(isWorkerFirstReaderRoute);

        expect(routes).toContain("/prompts");

        for (const route of routes) {
          const response = yield* Effect.promise(
            // @effect-diagnostics-next-line asyncFunction:off -- The Worker fetch handler returns a host Promise.
            async () =>
              await worker.fetch(
                new Request(`https://ratstack.sh${route}`, {
                  headers: { accept: "text/html" },
                })
              )
          );

          const served = yield* Effect.promise(response.text.bind(response));

          const prerendered = yield* fs.readFileString(
            `${dist}client${route}/index.html`
          );

          expect(response.headers.get("content-type")).toBe(
            "text/html; charset=utf-8"
          );
          expect(voidTagsAsParsed(served)).toBe(voidTagsAsParsed(prerendered));
        }
      }),
    60_000
  );
});
