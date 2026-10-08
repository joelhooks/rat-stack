import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ConfigProvider, Effect, Layer, Predicate, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import stack, { ProofRunIdSchema } from "../src/basin-proof-stage.js";

const services = Layer.mergeAll(
  AlchemyContextLive.pipe(Layer.provideMerge(NodeServices.layer)),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("proof-declaration-must-not-call-provider")
    )
  )
);

it.effect.prop(
  "each proof run declares only five disposable resources and refuses every other stage",
  { runId: ProofRunIdSchema, validStage: Schema.Boolean },
  ({ runId, validStage }) =>
    Effect.gen(function* declaration() {
      const result = yield* Effect.exit(
        stack.pipe(
          Effect.provide(services),
          Effect.provideService(Stage, validStage ? `proof-${runId}` : "prod"),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              BASIN_PROOF_RUN_ID: runId,
              BASIN_PROOF_TOKEN: "proof-test-token",
            })
          )
        )
      );

      if (!validStage) {
        expect(result._tag).toBe("Failure");

        return yield* Effect.void;
      }

      if (Predicate.isTagged(result, "Failure")) {
        return yield* Effect.die("proof-declaration-failed");
      }

      const resources = Object.values(result.value.resources);

      expect(resources.map((resource) => resource.Type).toSorted()).toEqual([
        "Cloudflare.Pipelines.Pipeline",
        "Cloudflare.Pipelines.Sink",
        "Cloudflare.Pipelines.Stream",
        "Cloudflare.R2.Bucket",
        "Cloudflare.R2.DataCatalog",
      ]);

      for (const resource of resources) {
        expect(resource.RemovalPolicy).toBe("destroy");

        if (resource.Type === "Cloudflare.R2.Bucket") {
          const props = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ forceDestroy: Schema.Boolean, name: Schema.String })
          )(resource.Props);

          expect(props).toEqual({
            forceDestroy: true,
            name: `rat-stack-erasure-proof-${runId}`,
          });
        }

        if (resource.Type === "Cloudflare.Pipelines.Stream") {
          const props = yield* Schema.decodeUnknownEffect(
            Schema.Struct({ http: Schema.Struct({ enabled: Schema.Boolean }) })
          )(resource.Props);

          expect(props.http.enabled).toBe(false);
        }

        if (resource.Type === "Cloudflare.R2.DataCatalog") {
          const props = yield* Schema.decodeUnknownEffect(
            Schema.Struct({
              compaction: Schema.Struct({ state: Schema.String }),
              snapshotExpiration: Schema.Struct({ state: Schema.String }),
            })
          )(resource.Props);

          expect(props.compaction.state).toBe("disabled");
          expect(props.snapshotExpiration.state).toBe("disabled");
        }
      }

      return yield* Effect.void;
    }),
  { arbitrary: { runs: 10 } }
);
