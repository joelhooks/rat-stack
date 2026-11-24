import {
  SkillBundle,
  mcpSkillOptions,
  skillBundlePath,
} from "@rat-stack/capability/skill-bundle";
import { Effect, FileSystem, Layer, Schema } from "effect";
import { McpServer } from "effect/ai";

const content = new URL("../../site/dist/content/", import.meta.url);

const Generation = Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u));

const decodeManifest = Schema.decodeEffect(
  Schema.fromJsonString(Schema.Struct({ generation: Generation }))
);

const decodeBundle = Schema.decodeEffect(
  Schema.fromJsonString(
    Schema.Struct({ data: SkillBundle, generation: Generation })
  )
);

class SkillBundleUnavailable extends Schema.TaggedError<
  SkillBundleUnavailable,
  { readonly brand: unique symbol }
>()("SkillBundleUnavailable", {
  cause: Schema.Unknown,
  message: Schema.String,
}) {}

const readSkills = Effect.gen(function* readSkillsAsset() {
  const fs = yield* FileSystem.FileSystem;

  const manifest = yield* fs.readFileString(
    new URL("manifest.json", content).pathname
  );

  const { generation } = yield* decodeManifest(manifest);
  const url = new URL(`assets/${generation}${skillBundlePath}`, content);
  const bundle = yield* decodeBundle(yield* fs.readFileString(url.pathname));

  if (bundle.generation !== generation) {
    return yield* Effect.fail("Mismatched skill asset generation");
  }

  return bundle.data;
}).pipe(
  Effect.mapError(
    (cause) =>
      new SkillBundleUnavailable({
        cause,
        message:
          "The generated skill bundle is unavailable. The workspace MCP server needs the site's matching static asset generation. Fix: run `pnpm turbo run build --filter=@rat-stack/cli --summarize` and retry.",
      })
  )
);

export const mcpSkills = Layer.unwrap(
  readSkills.pipe(
    Effect.map((skills) =>
      Layer.mergeAll(
        Layer.empty,
        ...skills.map((skill) => McpServer.skill(mcpSkillOptions(skill)))
      )
    )
  )
);
