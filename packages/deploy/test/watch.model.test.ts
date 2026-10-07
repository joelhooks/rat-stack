import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";

import { nextWatchEvidence, watchDeployment } from "../src/watch.js";
import type { WatchEvidence } from "../src/watch.js";

it.effect.prop(
  "only adjacent content 500 cycles accumulate the failure threshold",
  {
    history: Schema.Array(Schema.Literals([200, 500, 503])).check(
      Schema.isMaxLength(30)
    ),
  },
  ({ history }) =>
    Effect.sync(() => {
      let evidence: WatchEvidence = { cycles: 0, observations: [], streak: 0 };
      let expected = 0;

      for (const [index, status] of history.entries()) {
        expected = status === 500 ? expected + 1 : 0;
        evidence = nextWatchEvidence(evidence, [
          {
            accept: "text/html",
            body: `failure-${index}`,
            content: true,
            observedAt: index,
            route: "/",
            status,
          },
          {
            accept: "*/*",
            body: "agent failure",
            content: false,
            observedAt: index,
            route: "/.well-known/mcp.json",
            status: 500,
          },
        ]);

        expect(evidence.streak).toBe(expected);
        expect(evidence.cycles).toBe(index + 1);
        expect(evidence.observations[0]?.body).toBe("failure-0");
        expect(evidence.observations).toHaveLength((index + 1) * 2);
      }
    }),
  { arbitrary: { runs: 100 } }
);

it.effect(
  "two failing cycles stop early and retain first incident and bounded body",
  () =>
    Effect.gen(function* testWatch() {
      const requests: string[] = [];

      const client = HttpClient.make((request) => {
        requests.push(request.headers.accept ?? "missing");

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("x".repeat(1000), {
              headers: { "x-incident-id": "incident-first" },
              status: 500,
            })
          )
        );
      });

      const fiber = yield* watchDeployment(
        "https://example.test",
        100,
        10
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.result,
        Effect.forkChild
      );

      yield* TestClock.adjust(100);
      const result = yield* Fiber.join(fiber);

      expect(result._tag).toBe("Failure");

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("consecutive-content-500-cycles");
        expect(result.failure.evidence.cycles).toBe(2);
        expect(result.failure.evidence.observations[0]?.incidentId).toBe(
          "incident-first"
        );
        expect(result.failure.evidence.observations[0]?.body).toHaveLength(300);
      }

      expect(requests).toHaveLength(24);
      expect(new Set(requests)).toStrictEqual(new Set(["*/*", "text/html"]));
    })
);
