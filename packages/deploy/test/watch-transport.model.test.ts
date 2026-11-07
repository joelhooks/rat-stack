import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";

import {
  nextWatchEvidence,
  observeWatchCycle,
  watchDeployment,
  watchFailureReason,
  watchVerdict,
} from "../src/watch.js";
import type { WatchEvidence } from "../src/watch.js";

const Outcome = Schema.Literals([-1, 0, 200, 404, 503]);

const Cycle = Schema.Tuple([Outcome, Outcome, Outcome]);

const transportError = (request: HttpClientRequest.HttpClientRequest) => {
  // @effect-diagnostics-next-line unstableApiUsage:off -- The supplied client models the pinned HTTP transport failure without using a network.
  const reason = new HttpClientError.TransportError({ request });

  // @effect-diagnostics-next-line unstableApiUsage:off -- The pinned client requires its typed error wrapper at this test boundary.
  return new HttpClientError.HttpClientError({ reason });
};

it.prop(
  "generated cycle histories distinguish HTTP failures, persistent transport, unreachable cycles and isolated blips",
  {
    history: Schema.Array(Cycle).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20)
    ),
  },
  ({ history }) => {
    let evidence: WatchEvidence = {
      cycles: 0,
      observations: [],
      routes: [],
      streak: 0,
    };

    for (const [index, cycle] of history.entries()) {
      const observations = cycle.flatMap((status, route) =>
        status === -1
          ? []
          : [
              {
                accept: "text/html",
                body: "",
                content: true,
                observedAt: index,
                route: `/r/${route}`,
                status,
              },
            ]
      );

      evidence = nextWatchEvidence(evidence, observations);

      const responded = cycle.filter((status) => status > 0);
      const sampled = cycle.filter((status) => status !== -1);
      const httpFailed = responded.some((status) => status !== 200);

      const unreachable =
        sampled.length > 0 && sampled.every((status) => status === 0);

      const persistent = cycle.some(
        (status, route) => status === 0 && history[index - 1]?.[route] === 0
      );

      let reason: string | undefined;

      if (httpFailed) {
        reason = "non-200-or-incomplete-watch";
      } else if (unreachable) {
        reason = "cycle-unreachable";
      } else if (persistent) {
        reason = "persistent-transport-failure";
      }

      expect(watchFailureReason(evidence)).toBe(reason);
      expect(evidence.observations).toHaveLength(
        history
          .slice(0, index + 1)
          .flat()
          .filter((status) => status !== -1).length
      );

      if (reason !== undefined) {
        break;
      }
    }
  },
  { arbitrary: { runs: 1000 } }
);

it.effect(
  "transport retries recover on the second attempt through the supplied HttpClient layer",
  () =>
    Effect.gen(function* retryRecovery() {
      const attempts = new Map<string, number>();

      const client = HttpClient.make((request) =>
        Effect.suspend(() => {
          const key = `${new URL(request.url).pathname}:${request.headers.accept}`;
          const attempt = (attempts.get(key) ?? 0) + 1;
          attempts.set(key, attempt);

          return attempt === 1
            ? Effect.fail(transportError(request))
            : Effect.succeed(
                HttpClientResponse.fromWeb(request, new Response("ok"))
              );
        })
      );

      const clientLayer = Layer.succeed(HttpClient.HttpClient, client);

      const fiber = yield* observeWatchCycle({
        baseUrl: "https://example.test",
        deadline: 10_000,
        intervalMs: 10,
        routes: [],
        sweepCycles: 1,
      }).pipe(Effect.provide(clientLayer), Effect.forkChild);

      yield* TestClock.adjust(1000);
      const result = yield* Fiber.join(fiber);

      expect(result.observations).toHaveLength(12);
      expect(result.observations.every((row) => row.status === 200)).toBe(true);
      expect([...attempts.values()]).toStrictEqual(
        Array.from({ length: 12 }, () => 2)
      );
    })
);

it.effect.prop(
  "real HTTP responses are never retried even when their error body cannot be read",
  { status: Schema.Literals([200, 404, 500, 503]) },
  ({ status }) =>
    Effect.gen(function* realResponse() {
      let attempts = 0;

      const client = HttpClient.make((request) => {
        attempts += 1;

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response(
              new ReadableStream({
                start: (controller) => {
                  controller.error(new Error("body unavailable"));
                },
              }),
              { status }
            )
          )
        );
      });

      const result = yield* observeWatchCycle({
        baseUrl: "https://example.test",
        deadline: 10_000,
        intervalMs: 10,
        routes: [],
        sweepCycles: 1,
      }).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(attempts).toBe(12);
      expect(result.observations.map((row) => row.status)).toStrictEqual(
        Array.from({ length: 12 }, () => status)
      );
    })
);

const transportSite = (
  transport: (path: string, attempt: number) => boolean
) => {
  const attempts = new Map<string, number>();

  return HttpClient.make((request) =>
    Effect.suspend(() => {
      const path = new URL(request.url).pathname;
      const key = `${path}:${request.headers.accept}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);

      if (transport(path, attempt)) {
        return Effect.fail(transportError(request));
      }

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            path === "/sitemap.xml"
              ? "<urlset><url><loc>https://example.test/r/0</loc></url></urlset>"
              : "ok"
          )
        )
      );
    })
  );
};

it.effect.prop(
  "the running watch preserves isolated blips but fails persistent transport and unreachable cycles",
  {
    mode: Schema.Literals([
      "isolated",
      "persistent",
      "unreachable",
      "uncovered",
    ]),
  },
  ({ mode }) =>
    Effect.gen(function* runningWatch() {
      const client = transportSite((path, attempt) => {
        if (mode === "unreachable") {
          return true;
        }

        if (mode === "uncovered") {
          return path === "/r/0";
        }

        return path === "/" && (mode === "persistent" || attempt <= 3);
      });

      const fiber = yield* watchDeployment(
        "https://example.test",
        mode === "uncovered" ? 500 : 3000,
        10
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.result,
        Effect.forkChild
      );

      yield* TestClock.adjust(20_000);
      const result = yield* Fiber.join(fiber);

      if (mode === "isolated") {
        expect(result._tag).toBe("Success");

        if (Result.isSuccess(result)) {
          expect(
            result.success.observations.filter((row) => row.status === 0)
          ).toHaveLength(2);
        }
      } else {
        expect(result._tag).toBe("Failure");

        if (Result.isFailure(result)) {
          const reasons = {
            persistent: "persistent-transport-failure",
            uncovered: "route-coverage-incomplete",
            unreachable: "cycle-unreachable",
          };

          expect(result.failure.reason).toBe(reasons[mode]);
        }
      }
    }),
  { arbitrary: { runs: 20 } }
);

it.effect(
  "verdict counts retain blips separately from real non-200 responses",
  () =>
    Effect.gen(function* verdictCounts() {
      const fiber = yield* watchVerdict("https://example.test").pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          transportSite((path, attempt) => path === "/" && attempt <= 3)
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust(700_000);
      const verdict = yield* Fiber.join(fiber);

      expect(verdict.outcome).toBe("passed");
      expect(verdict.counts.transportBlips).toBe(2);
      expect(verdict.counts.nonOk).toBe(0);
      expect(verdict.provenance).toHaveLength(2);
    })
);
