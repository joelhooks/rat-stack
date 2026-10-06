import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import stack from "../alchemy.run.js";

const services = Layer.mergeAll(
  AlchemyContextLive.pipe(Layer.provideMerge(NodeServices.layer)),
  Layer.succeed(Stage, "prod"),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("stack-declaration-must-not-call-provider")
    )
  )
);

it.effect.prop(
  "every durable production resource declared by the Stack retains its physical object",
  { enabled: Schema.Boolean },
  ({ enabled }) =>
    Effect.gen(function* test() {
      for (const captureEnabled of [enabled, !enabled]) {
        const compiled = yield* stack.pipe(
          Effect.provide(services),
          Effect.provideService(
            ConfigProvider.ConfigProvider,
            ConfigProvider.fromUnknown({
              EMAIL_FORWARD_TO: "forward@example.test",
              EVENTS_ENABLED: captureEnabled,
            })
          )
        );

        const resources = Object.values(compiled.resources);

        const durable = resources.filter(
          (resource) =>
            ![
              "Cloudflare.Worker",
              "Cloudflare.WorkerLoader",
              "Cloudflare.RateLimit",
              "Cloudflare.DurableObjectNamespace",
            ].includes(resource.Type)
        );

        expect(durable.length).toBeGreaterThan(0);

        for (const resource of durable) {
          expect(
            resource.RemovalPolicy,
            `${resource.Type}:${resource.FQN}`
          ).toBe("retain");
        }
      }
    }),
  { arbitrary: { runs: 4 } }
);
