import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { AuthProviders, Stage } from "alchemy";
import { AlchemyContextLive } from "alchemy/AlchemyContext";
import { tryFindProviderRegistrationByType } from "alchemy/Provider";
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";

import stack from "../alchemy.run.js";

const services = Layer.mergeAll(
  AlchemyContextLive.pipe(Layer.provideMerge(NodeServices.layer)),
  Layer.succeed(Stage, "prod"),
  Layer.succeed(AuthProviders, {}),
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make(() =>
      Effect.die("provider-coverage-must-not-call-cloud-api")
    )
  )
);

it.effect.prop(
  "the production Stack provides every declared resource type in every auth and events flag combination",
  { auth: Schema.Boolean, events: Schema.Boolean },
  ({ auth, events }) =>
    Effect.gen(function* checkStackProviders() {
      for (const authEnabled of [auth, !auth]) {
        for (const eventsEnabled of [events, !events]) {
          const compiled = yield* stack.pipe(
            Effect.provide(services),
            Effect.provideService(
              ConfigProvider.ConfigProvider,
              ConfigProvider.fromUnknown({
                AUTH_ENABLED: authEnabled,
                EMAIL_FORWARD_TO: "forward@example.test",
                EVENTS_ENABLED: eventsEnabled,
              })
            )
          );

          const resources = Object.values(compiled.resources);

          expect(resources.length).toBeGreaterThan(0);
          expect(
            resources.some((resource) => resource.Type === "Drizzle.Schema")
          ).toBe(true);

          for (const resource of resources) {
            const provider = yield* tryFindProviderRegistrationByType(
              resource.Type
            ).pipe(Effect.provideContext(compiled.services));

            expect(
              Option.isSome(provider),
              `${resource.FQN}: provider missing for ${resource.Type}; AUTH_ENABLED=${authEnabled}; EVENTS_ENABLED=${eventsEnabled}`
            ).toBe(true);
          }

          const actions = Object.values(compiled.actions);

          expect(
            actions.some((action) => action.Type === "BetterAuth.Migrate")
          ).toBe(authEnabled);

          for (const action of actions) {
            expect(action.Kind, action.FQN).toBe("action");
            expect(action.Run, action.FQN).toBeTypeOf("function");
          }
        }
      }
    }),
  { arbitrary: { runs: 2 } }
);
