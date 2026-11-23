import { expect, it } from "@effect/vitest";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
} from "@rat-stack/core/interest";
import { Effect, Layer, Redacted } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { scriptedIntakeLayer } from "../../../packages/core/test/fixtures/scripted-intake.js";
import { interestRoutes } from "../src/interest/routes.js";

it.effect(
  "retention backfill authenticates the operator and validates page controls and apply mode",
  () =>
    Effect.gen(function* protectedBackfill() {
      const runs: boolean[] = [];

      const counts = {
        current: 1,
        erase: 0,
        finished: 2,
        gone: 0,
        legacyHandoffTimeUnknown: 0,
        nextCursor: null,
        pending: 3,
        unreadable: 0,
      };

      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestMode.layer("drovr"),
          InterestTokens.layer(Redacted.make("synthetic-secret")),
          SubscriberConfirm.unconfigured,
          scriptedIntakeLayer()
        )
      );

      const routes = interestRoutes({
        operatorToken: "synthetic-operator",
        services,
        backfill: {
          run: (dryRun) =>
            Effect.sync(() => {
              runs.push(dryRun);

              return counts;
            }),
        },
      });

      const { handler, dispose } = HttpRouter.toWebHandler(routes, {
        disableLogger: true,
      });

      yield* Effect.addFinalizer(() => Effect.promise(dispose));

      for (const token of [undefined, "wrong", "synthetic-operator"]) {
        for (const { body, status } of [
          { body: {}, status: 200 },
          { body: { apply: false }, status: 200 },
          { body: { apply: true }, status: 200 },
          { body: { apply: "true" }, status: 400 },
          { body: { limit: 1, after: "synthetic-cursor" }, status: 200 },
          { body: { limit: 0 }, status: 400 },
          { body: { limit: 51 }, status: 400 },
        ]) {
          const response = yield* Effect.promise(() =>
            handler(
              new Request(
                "https://ratstack.sh/operator/interest/applications/retention-backfill",
                {
                  method: "POST",
                  headers:
                    token === undefined
                      ? {}
                      : { authorization: `Bearer ${token}` },
                  body: JSON.stringify(body),
                }
              )
            )
          );

          expect(response.status).toBe(
            token === "synthetic-operator" ? status : 401
          );
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(response.headers.get("x-robots-tag")).toBe("noindex");

          if (response.status === 200) {
            expect(yield* Effect.promise(() => response.json())).toEqual(
              counts
            );
          }
        }
      }

      expect(runs).toEqual([true, true, false, true]);

      const brokenRoutes = interestRoutes({
        operatorToken: "synthetic-operator",
        services,
        backfill: { run: () => Effect.die("synthetic-private-defect") },
      });

      const broken = HttpRouter.toWebHandler(brokenRoutes, {
        disableLogger: true,
      });

      yield* Effect.addFinalizer(() => Effect.promise(broken.dispose));

      const failure = yield* Effect.promise(() =>
        broken.handler(
          new Request(
            "https://ratstack.sh/operator/interest/applications/retention-backfill",
            {
              method: "POST",
              headers: { authorization: "Bearer synthetic-operator" },
              body: "{}",
            }
          )
        )
      );

      expect(failure.status).toBe(503);
      expect(yield* Effect.promise(() => failure.json())).toEqual({
        error: "applications_unavailable",
        step: "route_defect",
        submissionId: null,
        kind: "Defect",
        name: "Unknown",
      });
    }).pipe(Effect.scoped)
);
