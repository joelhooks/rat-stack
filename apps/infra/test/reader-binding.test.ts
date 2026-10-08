import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import * as Output from "alchemy/Output";
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
      Effect.die("binding-declaration-must-not-call-provider")
    )
  ),
  ConfigProvider.layer(
    ConfigProvider.fromUnknown({
      EMAIL_FORWARD_TO: "forward@example.test",
    })
  )
);

it.effect(
  "binds Website delivery behind Mischief without moving the domain",
  () =>
    Effect.gen(function* checkReaderBinding() {
      const compiled = yield* stack;

      const declared = yield* Schema.decodeUnknownEffect(
        Schema.Struct({
          bindings: Schema.Array(
            Schema.Struct({
              name: Schema.String,
              service: Schema.Unknown,
              type: Schema.String,
            })
          ),
        })
      )(
        compiled.bindings.Mischief?.find((binding) => binding.sid === "Website")
          ?.data
      );

      expect(declared.bindings).toHaveLength(1);

      const binding = declared.bindings.at(0);

      expect(binding).toMatchObject({ name: "WEBSITE", type: "service" });

      const upstream = yield* Schema.decodeUnknownEffect(
        Schema.Record(Schema.String, Schema.Unknown)
      )(Output.resolveUpstream(binding?.service));

      expect(Object.keys(upstream)).toEqual(["Website"]);
      expect(compiled.resources.Mischief?.Props).toMatchObject({
        domain: { name: "ratstack.sh", redirects: ["www.ratstack.sh"] },
      });
      expect(compiled.resources.Website?.Props).not.toHaveProperty("domain");
      expect(compiled.resources.Website?.Props).toMatchObject({
        workersDev: false,
      });
    }).pipe(Effect.provide(services))
);
