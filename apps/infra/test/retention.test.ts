import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { ConfigProvider, Effect, Layer, Schema } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";
import * as HttpClient from "effect/http/HttpClient";

import stack from "../alchemy.run.js";

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
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("stack-declaration-must-not-call-provider")
    )
  )
);

it.effect.prop(
  "durable stage-owned resources destroy outside prod while shared production infrastructure retains",
  {
    enabled: Schema.Boolean,
    suffix: Schema.String.check(Schema.isPattern(/^[a-z]{1,12}$/u)),
  },
  ({ enabled, suffix }) =>
    Effect.gen(function* test() {
      for (const stage of ["prod", `lane-${suffix}`, `live_${suffix}`]) {
        for (const captureEnabled of [enabled, !enabled]) {
          const compiled = yield* stack.pipe(
            Effect.provide(services),
            Effect.provideService(Stage, stage),
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromUnknown({
                AUTH_ENABLED: true,
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
            ).toBe(
              resource.Type.startsWith("Cloudflare.DNS.") ||
                resource.Type.startsWith("Cloudflare.Email.") ||
                resource.Type === "Cloudflare.Zone.Zone" ||
                stage === "prod"
                ? "retain"
                : "destroy"
            );
          }
        }
      }
    }),
  { arbitrary: { runs: 4 }, timeout: 30_000 }
);
