import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";

const Dependencies = Schema.fromJsonString(
  Schema.Struct({
    dependencies: Schema.Record(Schema.String, Schema.String),
  })
);

it.layer(NodeServices.layer)("provider client pins", (test) => {
  test.effect(
    "recovery uses exactly the provider client pinned by Alchemy",
    () =>
      Effect.gen(function* testPin() {
        const fs = yield* FileSystem.FileSystem;

        const deploy = yield* fs
          .readFileString("package.json")
          .pipe(Effect.flatMap(Schema.decodeEffect(Dependencies)));

        const alchemy = yield* fs
          .readFileString("node_modules/alchemy/package.json")
          .pipe(Effect.flatMap(Schema.decodeEffect(Dependencies)));

        const declared = deploy.dependencies["@distilled.cloud/cloudflare"];

        expect(declared).toBeDefined();
        expect(declared).toBe(
          alchemy.dependencies["@distilled.cloud/cloudflare"]
        );
      })
  );
});
