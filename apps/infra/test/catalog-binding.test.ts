import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import * as Output from "alchemy/Output";
import { unpackEnvValue } from "alchemy/RuntimeContext";
import { State } from "alchemy/State";
import { ConfigProvider, Effect, Layer, Redacted, Schema } from "effect";
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
  Layer.succeed(Stage, "prod"),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("catalog-declaration-must-not-call-provider")
    )
  )
);

for (const { token, label } of [
  { token: undefined, label: "absent" },
  { token: "", label: "empty" },
  { token: "synthetic-declaration-token", label: "configured" },
]) {
  it.effect(
    `declares the optional catalog secret and projection database with ${label} credentials`,
    () =>
      Effect.gen(function* verifyCatalogBindings() {
        const base = { EMAIL_FORWARD_TO: "forward@example.test" };

        const environment =
          token === undefined
            ? base
            : { ...base, CATALOG_OPERATOR_TOKEN: token };

        const config = ConfigProvider.fromUnknown(environment);

        const compiled = yield* stack.pipe(
          Effect.provide(services),
          Effect.provideService(ConfigProvider.ConfigProvider, config)
        );

        const props = yield* Schema.decodeUnknownEffect(
          Schema.Struct({
            env: Schema.Record(Schema.String, Schema.Unknown),
          })
        )(compiled.resources.CatalogWorker?.Props);

        if (token === undefined || token === "") {
          expect(props.env).not.toHaveProperty("CATALOG_OPERATOR_TOKEN");
        } else {
          const bound = yield* Output.evaluate(
            props.env.CATALOG_OPERATOR_TOKEN,
            {}
          ).pipe(
            Effect.provideService(
              State,
              Effect.die("secret-evaluation-must-not-read-state")
            ),
            Effect.provideService(ConfigProvider.ConfigProvider, config)
          );

          expect(Redacted.isRedacted(bound)).toBe(true);

          if (Redacted.isRedacted(bound)) {
            const packed = yield* Schema.decodeUnknownEffect(Schema.String)(
              Redacted.value(bound)
            );

            const runtimeToken = yield* Schema.decodeUnknownEffect(
              Schema.Redacted(Schema.String)
            )(unpackEnvValue<unknown>(packed));

            expect(Redacted.value(runtimeToken)).toBe(token);
          }
        }

        const databases = Object.values(compiled.resources).filter(
          (resource) =>
            resource.Type === "Cloudflare.D1Database" &&
            resource.FQN.includes("CatalogIndexDatabase")
        );

        expect(databases).toHaveLength(1);
        expect(databases.at(0)?.RemovalPolicy).toBe("retain");
      })
  );
}
