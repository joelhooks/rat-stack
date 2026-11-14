import { fileURLToPath } from "node:url";

import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  FileSystem,
  Layer,
  Schema,
} from "effect";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpClient from "effect/http/HttpClient";

import { WebsiteContentManifestError } from "../../web/src/website-content-manifest-error.js";
import stack from "../alchemy.run.js";

const manifestPath = fileURLToPath(
  new URL("../../site/dist/content/manifest.json", import.meta.url)
);

const services = Layer.mergeAll(
  AlchemyContextLive.pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        NodeServices.layer,
        SecureRandom.layerWebCrypto,
        Digest.layerWebCrypto
      )
    )
  ),
  Layer.succeed(Stage, "prod"),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() => Effect.die("manifest-check-must-not-call-provider"))
  ),
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({ EMAIL_FORWARD_TO: "forward@example.test" })
  )
);

const scenarios = [
  {
    name: "missing file",
    read: FileSystem.makeNoop({}).readFileString(manifestPath),
  },
  { name: "malformed JSON", read: Effect.succeed("{") },
  { name: "missing generation", read: Effect.succeed("{}") },
  { name: "empty generation", read: Effect.succeed('{"generation":""}') },
];

for (const scenario of scenarios) {
  it.effect(`explains how to repair a manifest with ${scenario.name}`, () =>
    Effect.gen(function* checkManifestFailure() {
      const fs = yield* FileSystem.FileSystem;
      const suppliedRead = yield* Effect.exit(scenario.read);

      const exit = yield* stack.pipe(
        Effect.provideService(FileSystem.FileSystem, {
          ...fs,
          readFileString: (path, encoding) =>
            path === manifestPath
              ? suppliedRead
              : fs.readFileString(path, encoding),
        }),
        Effect.exit
      );

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        expect(Cause.hasDies(exit.cause)).toBe(true);

        const error = yield* Schema.decodeUnknownEffect(
          Schema.toType(WebsiteContentManifestError)
        )(Cause.squash(exit.cause));

        expect(error.path).toBe(manifestPath);
        expect(error.message).toContain(manifestPath);
        expect(error.message).toContain(
          "pnpm --filter @rat-stack/site generate"
        );
        expect(error.message).toContain("pnpm build");
        expect(error.cause).toBeDefined();

        if (Exit.isFailure(suppliedRead)) {
          expect(error.cause).toBe(Cause.squash(suppliedRead.cause));
        } else {
          expect(Schema.isSchemaError(error.cause)).toBe(true);
        }
      }
    }).pipe(Effect.provide(services))
  );
}

it.effect("binds the built manifest generation to Website props", () =>
  Effect.gen(function* checkManifestGeneration() {
    const fs = yield* FileSystem.FileSystem;

    const manifest = yield* fs
      .readFileString(manifestPath)
      .pipe(
        Effect.flatMap(
          Schema.decodeEffect(
            Schema.fromJsonString(
              Schema.Struct({ generation: Schema.NonEmptyString })
            )
          )
        )
      );

    const compiled = yield* stack;

    expect(compiled.resources.Website?.Props).toMatchObject({
      env: { CONTENT_GENERATION: manifest.generation },
    });
  }).pipe(Effect.provide(services))
);
