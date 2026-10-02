import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

import { ContentAssetManifest, emitAssets } from "../scripts/emit-assets.ts";

it.effect(
  "publishes complete identical asset sets from concurrent generators",
  () =>
    Effect.gen(function* concurrentAssetPublication() {
      const fs = yield* FileSystem.FileSystem;
      const temporary = yield* fs.makeTempDirectoryScoped();
      const directory = `${temporary}/content`;

      const input = {
        directory,
        images: [{ base64: "AQID", path: "/photo.jpg" }],
        pages: [
          { documentHtml: "<h1>Home</h1>", routePath: "/", text: "# Home" },
          {
            documentHtml: "<h1>Nested</h1>",
            routePath: "/nested/page",
            text: "# Nested",
          },
        ],
      };

      yield* emitAssets({
        directory,
        images: [],
        pages: [{ documentHtml: "old", routePath: "/old", text: "old" }],
      });
      yield* fs.writeFileString(`${directory}/assets/AGENTS.md.html`, "legacy");
      yield* fs.makeDirectory(`${directory}/assets/lore`, { recursive: true });
      yield* fs.writeFileString(`${directory}/assets/lore/old.md`, "legacy");

      yield* Effect.all([emitAssets(input), emitAssets(input)], {
        concurrency: "unbounded",
      });

      const manifest = yield* Schema.decodeEffect(
        Schema.fromJsonString(ContentAssetManifest)
      )(yield* fs.readFileString(`${directory}/manifest.json`));

      expect(manifest.pages.map((page) => page.route)).toEqual([
        "/",
        "/nested/page",
      ]);

      for (const page of manifest.pages) {
        const source = input.pages.find(
          (candidate) => candidate.routePath === page.route
        );

        expect(
          yield* fs.readFileString(
            `${directory}/assets/${manifest.generation}${page.html}`
          )
        ).toBe(source?.documentHtml);
        expect(
          yield* fs.readFileString(
            `${directory}/assets/${manifest.generation}${page.markdown}`
          )
        ).toBe(source?.text);
      }

      expect(manifest.images).toHaveLength(1);
      expect(yield* fs.readDirectory(`${directory}/assets`)).toEqual([
        manifest.generation,
      ]);

      for (const image of manifest.images) {
        expect(
          new Uint8Array(
            yield* fs.readFile(
              `${directory}/assets/${manifest.generation}${image}`
            )
          )
        ).toEqual(new Uint8Array([1, 2, 3]));
      }
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
