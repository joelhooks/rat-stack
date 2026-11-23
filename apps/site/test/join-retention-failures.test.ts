import { inspect } from "node:util";

import { expect, it } from "@effect/vitest";
import {
  InterestDirectory,
  InterestMode,
  InterestTokens,
  SubscriberConfirm,
} from "@rat-stack/core/interest";
import { JoinRetentionBackfillUnavailable } from "@rat-stack/core/join-interest";
import type { JoinRetentionBackfill } from "@rat-stack/core/join-interest";
import { Effect, Layer, Logger, Redacted, Tracer } from "effect";
import * as HttpRouter from "effect/http/HttpRouter";

import { scriptedIntakeLayer } from "../../../packages/core/test/fixtures/scripted-intake.js";
import { mischiefRoutes } from "../src/app.js";
import { interestOperatorOptions } from "../src/interest/operator-options.js";
import { TestSandbox } from "./test-sandbox.js";

it.effect(
  "retention route fallbacks return distinct allowlisted diagnostics without secrets in bodies, logs or spans",
  () =>
    Effect.gen(function* safeRouteFailures() {
      const secret = "synthetic-planted-private-token@example.test";
      const logs: unknown[] = [];
      const spans: Tracer.NativeSpan[] = [];

      const services = yield* Layer.build(
        Layer.mergeAll(
          InterestDirectory.memory,
          InterestMode.layer("drovr"),
          InterestTokens.layer(Redacted.make(secret)),
          SubscriberConfirm.unconfigured,
          scriptedIntakeLayer({ submit: () => Effect.die(secret) })
        )
      );

      const unconfigured = yield* interestOperatorOptions();

      const branches: readonly {
        readonly backfill: JoinRetentionBackfill["Service"] | undefined;
        readonly step:
          | "route_not_configured"
          | "route_unavailable"
          | "route_defect";
        readonly name: "Unknown" | "TypeError";
      }[] = [
        {
          backfill: unconfigured.backfill,
          step: "route_not_configured",
          name: "Unknown",
        },
        {
          backfill: {
            run: () =>
              Effect.fail(
                new JoinRetentionBackfillUnavailable({ reason: secret })
              ),
          },
          step: "route_unavailable",
          name: "Unknown",
        },
        {
          backfill: { run: () => Effect.die(new TypeError(secret)) },
          step: "route_defect",
          name: "TypeError",
        },
      ];

      for (const branch of branches) {
        const { handler, dispose } = HttpRouter.toWebHandler(
          mischiefRoutes({
            interest: {
              services,
              operatorToken: secret,
              backfill: branch.backfill,
            },
          }).pipe(
            Layer.provide(
              Layer.mergeAll(
                TestSandbox,
                Logger.layer([
                  Logger.make(({ message }) => logs.push(message)),
                ]),
                Layer.succeed(
                  Tracer.Tracer,
                  Tracer.make({
                    span: (options) => {
                      const span = new Tracer.NativeSpan(options);
                      spans.push(span);

                      return span;
                    },
                  })
                )
              )
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
                      ? { authorization: `Bearer ${secret}` }
                      : { authorization: `Bearer ${secret}`, accept },
                  body: "{}",
                }
              )
            )
          );

          expect(response.status).toBe(503);
          expect(response.headers.get("content-type")).toContain(
            "application/json"
          );
          expect(response.headers.get("cache-control")).toBe("no-store");
          expect(response.headers.get("x-robots-tag")).toBe("noindex");
          const body = yield* Effect.promise(() => response.text());
          expect(body).not.toContain(secret);
          expect(JSON.parse(body)).toEqual({
            error: "applications_unavailable",
            step: branch.step,
            submissionId: null,
            kind: "Defect",
            name: branch.name,
          });
        }
      }

      expect(JSON.stringify(logs)).not.toContain(secret);
      expect(
        inspect(
          spans.map((span) => ({
            attributes: [...span.attributes],
            events: span.events,
            status: span.status,
          })),
          { depth: null }
        )
      ).not.toContain(secret);
    }).pipe(Effect.scoped)
);
