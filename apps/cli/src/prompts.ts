import { PromptLibrary } from "@rat-stack/core";
import {
  AssetReadError,
  Prompt,
  UnknownPrompt,
} from "@rat-stack/core/contracts";
import { Effect, FileSystem, Layer, Path, Schema } from "effect";

export const localPromptLibraryLayer = Layer.effect(
  PromptLibrary,
  Effect.gen(function* makeLocalPromptLibrary() {
    const fs = yield* FileSystem.FileSystem;
    const paths = yield* Path.Path;
    const directory = paths.join(process.cwd(), "apps/site/dist/content");
    const manifestPath = paths.join(directory, "manifest.json");

    const manifest = fs.readFileString(manifestPath).pipe(
      Effect.flatMap(
        Schema.decodeUnknownEffect(
          Schema.fromJsonString(
            Schema.Struct({
              generation: Schema.String.check(
                Schema.isPattern(/^[0-9a-f]{64}$/u)
              ),
            })
          )
        )
      ),
      Effect.mapError(
        (cause) =>
          new AssetReadError({ cause, path: manifestPath, reason: "provider" })
      )
    );

    const prompts = manifest.pipe(
      Effect.flatMap(({ generation }) => {
        const path = paths.join(
          directory,
          "assets",
          generation,
          "_content/prompts.json"
        );

        return fs.readFileString(path).pipe(
          Effect.flatMap(
            Schema.decodeUnknownEffect(
              Schema.fromJsonString(
                Schema.Struct({
                  data: Schema.Array(Prompt),
                  generation: Schema.String,
                })
              )
            )
          ),
          Effect.mapError(
            (cause) => new AssetReadError({ cause, path, reason: "provider" })
          ),
          Effect.filterOrFail(
            (envelope) => envelope.generation === generation,
            () =>
              new AssetReadError({
                cause: "Prompt generation differs from manifest",
                path,
                reason: "generation",
              })
          ),
          Effect.map((envelope) => envelope.data)
        );
      })
    );

    return PromptLibrary.of({
      get: (slug) =>
        prompts.pipe(
          Effect.flatMap((all) => {
            const prompt = all.find((candidate) => candidate.slug === slug);

            return prompt === undefined
              ? Effect.fail(
                  new UnknownPrompt({
                    message: "Choose a slug returned by listPrompts.",
                    slug,
                  })
                )
              : Effect.succeed(prompt);
          })
        ),
      list: prompts.pipe(
        Effect.map((all) => all.map(({ body: _body, ...summary }) => summary))
      ),
    });
  })
);
