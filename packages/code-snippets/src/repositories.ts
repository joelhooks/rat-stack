import { Effect, Schema } from "effect";

import { CodeRepositoryConfigInvalid } from "./errors/code-repository-config-invalid.ts";
import type { CodeRequest } from "./model.ts";

export const RepositorySchema = Schema.Struct({
  adapter: Schema.NonEmptyString,
  id: Schema.NonEmptyString,
  linkTemplate: Schema.optionalKey(Schema.String),
  location: Schema.NonEmptyString,
  remote: Schema.optionalKey(Schema.NonEmptyString),
});

export const RepositoryRegistry = Schema.Array(RepositorySchema);

export type Repository = typeof RepositorySchema.Type;

export const decodeRepositories = Effect.fn("decodeRepositories")(
  function* decodeRepositories(input: Schema.Json) {
    const entries = yield* Schema.decodeUnknownEffect(RepositoryRegistry)(
      input
    ).pipe(
      Effect.mapError(
        () =>
          new CodeRepositoryConfigInvalid({
            fix: "Configure repositories as {id, adapter, location, linkTemplate?}.",
          })
      )
    );

    if (new Set(entries.map((entry) => entry.id)).size !== entries.length) {
      return yield* new CodeRepositoryConfigInvalid({
        fix: "Give each repository a unique id.",
      });
    }

    for (const entry of entries) {
      if (entry.linkTemplate !== undefined && entry.linkTemplate !== "") {
        const sample = entry.linkTemplate
          .replaceAll("{sha}", "sha")
          .replaceAll("{path}", "path")
          .replaceAll("{start}", "1")
          .replaceAll("{end}", "2");

        if (
          (!sample.startsWith("https://") && !sample.startsWith("http://")) ||
          sample.includes("{") ||
          sample.includes("}")
        ) {
          return yield* new CodeRepositoryConfigInvalid({
            fix: `Use an http(s) linkTemplate with {sha}, {path}, {start}, {end} for ${entry.id}, or omit it.`,
          });
        }
      }
    }

    return entries;
  }
);

export const sourceLink = (
  entry: Repository | undefined,
  request: CodeRequest
) =>
  (entry?.linkTemplate ?? "")
    .replaceAll("{sha}", request.commit)
    .replaceAll(
      "{path}",
      request.path.split("/").map(encodeURIComponent).join("/")
    )
    .replaceAll("{start}", String(request.ranges[0]?.start ?? 1))
    .replaceAll("{end}", String(request.ranges.at(-1)?.end ?? 1));
