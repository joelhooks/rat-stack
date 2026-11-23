import { expect, it } from "@effect/vitest";
import { AbuseScore, IntakeEvents, IntakeTicket } from "@rat-stack/core/intake";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { scriptedIntakeLayer } from "../../../packages/core/test/fixtures/scripted-intake.js";
import { mischiefRoutes } from "../src/app.js";
import { agentSignupLayer } from "../src/interest/join-layer.js";
import { interestOperatorOptions } from "../src/interest/operator-options.js";
import { withMemoryErasure } from "./join-erasure.fixture.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "worker operator options expose the join-layer retention preview to the authenticated route",
  () =>
    Effect.gen(function* workerRetentionPreview() {
      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestMode.layer("drovr"),
          InterestTokens.layer(Redacted.make("synthetic-secret")),
          SubscriberConfirm.unconfigured,
          scriptedIntakeLayer()
        )
      );

      const agentSignup = {
        applicationIds: () => Effect.succeed(["synthetic-missing"]),
        contacts: withMemoryErasure(() => ({
          joinRead: () => Effect.undefined,
          joinSave: () => Effect.die("preview must not save"),
          joinErase: () => Effect.die("missing contact must not erase"),
        })),
        intake: Layer.mergeAll(
          IntakeTicket.testLayer,
          AbuseScore.testLayer(),
          IntakeEvents.testLayer
        ),
      };

      const joinServices = yield* Layer.build(
        agentSignupLayer(agentSignup, services)
      );

      const operatorOptions = yield* interestOperatorOptions(
        agentSignup,
        joinServices
      );

      const { handler, dispose } = HttpRouter.toWebHandler(
        mischiefRoutes({
          interest: {
            operatorToken: "synthetic-operator",
            services,
            ...operatorOptions,
          },
        }).pipe(
          Layer.provide(
            Layer.mergeAll(TestSandbox, Layer.succeedContext(joinServices))
          )
        ),
        { disableLogger: true }
      );

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      for (const accept of [undefined, "application/json"]) {
        const response = yield* Effect.promise(() =>
          handler(
            new Request(
              "https://ratstack.sh/operator/interest/applications/retention-backfill",
              {
                method: "POST",
                headers:
                  accept === undefined
                    ? { authorization: "Bearer synthetic-operator" }
                    : { authorization: "Bearer synthetic-operator", accept },
                body: JSON.stringify({ apply: false, limit: 25 }),
              }
            )
          )
        );

        expect(response.status).toBe(200);
        expect(yield* Effect.promise(() => response.json())).toEqual({
          current: 0,
          erase: 0,
          finished: 0,
          gone: 1,
          legacyHandoffTimeUnknown: 1,
          nextCursor: null,
          pending: 0,
          unreadable: 0,
        });
      }
    }).pipe(Effect.scoped)
);
