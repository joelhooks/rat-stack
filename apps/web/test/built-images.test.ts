import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";

const imageSource = /<img\b[^>]*?\ssrc="(?<source>[^"]*)"/gu;

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

        const listing = yield* fs.readDirectory(client, { recursive: true });

        const shipped = new Set(
          listing.map((file) => `/${file.split(paths.sep).join("/")}`)
        );

        const sources = yield* Effect.forEach(
          listing.filter((file) => file.endsWith(".html")),
          (file) =>
            fs.readFileString(paths.join(client, file)).pipe(
              Effect.map((html) => ({
                file: file.split(paths.sep).join("/"),
                images: Array.from(
                  html.matchAll(imageSource),
                  (match) => match.groups?.source ?? ""
                ),
              }))
            ),
          { concurrency: 16 }
        );

        const index = sources.find(
          (page) => page.file === "all-stars/index.html"
        );

        expect(index?.images).toEqual(
          expect.arrayContaining(seed.map((person) => person.avatar.path))
        );

        const missing = sources.flatMap((page) =>
          page.images
            .filter(
              (source) =>
                source.startsWith("/") &&
                !source.startsWith("//") &&
                !shipped.has(new URL(source, "https://x.test").pathname)
            )
            .map((source) => ({ file: page.file, source }))
        );

        expect(missing).toEqual([]);
      })
  );
});
