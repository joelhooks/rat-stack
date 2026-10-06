import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import * as Alchemy from "alchemy";
import { importStack, StackModuleLoader } from "alchemy/Alchemist/Session";
import { AlchemyContext } from "alchemy/AlchemyContext";
import * as Cloudflare from "alchemy/Cloudflare";
import { collection } from "alchemy/Provider";
import { Stage } from "alchemy/Stage";
import { inMemoryState } from "alchemy/State";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  rpcContentDirectory,
  rpcProjection,
} from "../../mischief/src/rpc-worker.js";
import previewDefinition, { previewProgram } from "../alchemy.preview.js";
import { PreviewStage, previewResourcesAllowed } from "../src/preview.js";

it.effect("loads the preview through Alchemy's entrypoint boundary", () =>
  importStack("alchemy.preview.ts").pipe(
    Effect.provideService(StackModuleLoader, {
      // @effect-diagnostics-next-line asyncFunction:off -- Alchemy's module loader is a native Promise boundary.
      import: async () => await Promise.resolve({ default: previewDefinition }),
    }),
    Effect.provide(NodeServices.layer)
  )
);

it.effect.prop(
  "preview declarations contain only the Website and its isolated content backend",
  { stage: Arbitrary.schema(PreviewStage) },
  ({ stage }) =>
    Alchemy.Stack(
      "RatStackPreview",
      {
        providers: Layer.effect(Cloudflare.Providers, collection([])),
        state: inMemoryState(),
      },
      previewProgram
    ).pipe(
      Effect.tap((stack) =>
        Effect.gen(function* checkPreviewDeclaration() {
          expect(previewResourcesAllowed(stack.resources)).toBe(true);
          expect(stack.resources.Website?.Props).toMatchObject({
            assets: { runWorkerFirst: true },
            domain: { name: `${stage}.ratstack.sh`, zoneName: "ratstack.sh" },
            workersDev: false,
          });

          const websiteProps = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              env: Schema.Record(Schema.String, Schema.Unknown),
            })
          )(stack.resources.Website?.Props);

          expect(websiteProps.env.PREVIEW_COMMIT).toBe("a".repeat(40));
          expect(Object.keys(websiteProps.env).toSorted()).toEqual([
            "BACKEND",
            "PREVIEW_COMMIT",
          ]);

          const backendProps = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              assets: Schema.Struct({
                directory: Schema.String,
                htmlHandling: Schema.Literal("none"),
                runWorkerFirst: Schema.Literal(true),
              }),
              env: Schema.optional(
                Schema.Record(Schema.String, Schema.Unknown)
              ),
              workersDev: Schema.Boolean,
            })
          )(stack.resources.RpcBackend?.Props);

          expect(backendProps.assets.directory).toBe(rpcContentDirectory);
          expect(backendProps.workersDev).toBe(false);
          expect(Object.keys(backendProps.env ?? {})).toEqual([]);
          expect(
            [...rpcProjection.group.requests.keys()].every((name) =>
              [
                "search",
                "read",
                "backlinks",
                "neighbors",
                "mentions",
                "path",
              ].includes(name)
            )
          ).toBe(true);
        })
      ),
      Effect.provideService(Stage, stage),
      Effect.provideService(AlchemyContext, {
        adopt: false,
        dev: false,
        dotAlchemy: ".alchemy",
      }),
      Effect.provide(NodeServices.layer),
      Effect.provideService(
        ConfigProvider.ConfigProvider,
        ConfigProvider.fromUnknown({ PREVIEW_COMMIT: "a".repeat(40) })
      ),
      Effect.scoped,
      Effect.asVoid
    )
);

it.prop(
  "preview rejects every additional resource, including prod-only resources",
  {
    id: Schema.NonEmptyString,
    type: Schema.Literals([
      "Cloudflare.Zone",
      "Cloudflare.DNS.Record",
      "Cloudflare.Email.Routing",
      "Cloudflare.Ruleset",
      "Cloudflare.R2.Bucket",
      "Cloudflare.Worker",
    ]),
  },
  ({ id, type }) => {
    expect(
      previewResourcesAllowed({
        RpcBackend: { Type: "Cloudflare.Worker" },
        Website: { Type: "Cloudflare.Worker" },
        [`extra/${id}`]: { Type: type },
      })
    ).toBe(false);
  }
);
