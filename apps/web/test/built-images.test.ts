import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

const SeedAvatars = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({ avatar: Schema.Struct({ path: Schema.String }) })
  )
);

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "every image a built page loads from its own origin ships as a Website file",
    () =>
      Effect.gen(function* checkBuiltImages() {
        const fs = yield* FileSystem.FileSystem;
        const paths = yield* Path.Path;

        const seed = yield* fs
          .readFileString(
            paths.resolve(
              import.meta.dirname,
              "../../../.brain/data/cafe/people.json"
            )
          )
          .pipe(Effect.flatMap(Schema.decodeUnknownEffect(SeedAvatars)));

        const client = paths.resolve(import.meta.dirname, "../dist/client");

        const files = (yield* fs.readDirectory(client, { recursive: true }))
          .filter((file) => file.endsWith(".html"))
          .map((file) => paths.join(client, file));

        const sources = yield* Effect.forEach((file: string) =>
          fs.readFileString(file).pipe(
            Effect.map((html) => ({
              file: paths.relative(client, file),
              images: [
                ...new DOMParser()
                  .parseFromString(html, "text/html")
                  .querySelectorAll("img"),
              ].map((image) => image.getAttribute("src") ?? ""),
            }))
          )
        )(files);

        const index = sources.find(
          (page) => page.file === "all-stars/index.html"
        );

        expect(index?.images).toEqual(
          expect.arrayContaining(seed.map((person) => person.avatar.path))
        );

        const missing = yield* Effect.filter(
          sources.flatMap((page) =>
            page.images
              .filter(
                (source) => source.startsWith("/") && !source.startsWith("//")
              )
              .map((source) => ({ file: page.file, source }))
          ),
          ({ source }) =>
            fs
              .exists(
                paths.join(client, new URL(source, "https://x.test").pathname)
              )
              .pipe(Effect.map((exists) => !exists))
        );

        expect(missing).toEqual([]);
      })
  );
});
