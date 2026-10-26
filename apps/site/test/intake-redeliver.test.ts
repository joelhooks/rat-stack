import { expect, it } from "@effect/vitest";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpRouter from "effect/http/HttpRouter";

import { interestRoutes } from "../src/interest/routes.js";
import { fakeIntakeLayer } from "./fixtures/fake-intake.js";

it.effect.prop(
  "operator authorization guards redelivery and its private partial receipt",
  {
    authorized: Arbitrary.schema(Schema.Boolean),
    valid: Arbitrary.schema(Schema.Boolean),
  },
  ({ authorized, valid }) =>
    Effect.gen(function* operatorBoundary() {
      const calls: (readonly string[])[] = [];

      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestMode.layer("doi"),
          InterestTokens.layer(Redacted.make("synthetic-secret")),
          SubscriberConfirm.unconfigured,
          fakeIntakeLayer
        )
      );

      const receipt = {
        notAttempted: [],
        rows: [
          {
            outcome: "accepted",
            previousState: "ready",
            state: "accepted",
            submissionId: "synthetic-first",
          },
        ],
      } as const;

      const routes = interestRoutes({
        operatorToken: "synthetic-operator",
        redelivery: {
          redeliver: ({ submissionIds: ids }) =>
            Effect.sync(() => {
              calls.push([...ids]);

              return receipt;
            }),
        },
        services,
      });

      const { handler, dispose } = HttpRouter.toWebHandler(routes, {
        disableLogger: true,
      });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      const response = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- The in-memory router owns this Promise boundary.
        () =>
          handler(
            new Request(
              "https://ratstack.sh/operator/interest/applications/redeliver",
              {
                body: JSON.stringify({
                  submissionIds: valid ? ["synthetic-first"] : 42,
                }),
                headers: {
                  authorization: authorized
                    ? "Bearer synthetic-operator"
                    : "Bearer wrong",
                },
                method: "POST",
              }
            )
          )
      );

      const expectedStatus = authorized ? 400 : 401;
      expect(response.status).toBe(authorized && valid ? 200 : expectedStatus);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(response.headers.get("x-robots-tag")).toBe("noindex");
      expect(calls).toEqual(authorized && valid ? [["synthetic-first"]] : []);

      if (response.status === 200) {
        expect(yield* Effect.promise(response.json.bind(response))).toEqual(
          receipt
        );
      }
    }).pipe(Effect.scoped)
);
