import { expect, it } from "@effect/vitest";
import { Clock, Effect, Fiber, Layer, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientError from "effect/http/HttpClientError";
import type * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";

import {
  fixedWatchRoutes,
  nextWatchEvidence,
  observeWatchCycle,
  transportBlipRatioLimit,
  transportFailureCycles,
  watchCompletionFailureReason,
  watchDeployment,
  watchFailureReason,
  watchVerdict,
} from "../src/watch.js";
import type { WatchEvidence, WatchObservation } from "../src/watch.js";

const Outcome = Schema.Literals([-1, 0, 200, 404, 503]);

const Cycle = Schema.Tuple([Outcome, Outcome, Outcome]);

const WeightedTransportOutcome = Schema.Int.check(
  Schema.isBetween({ maximum: 9, minimum: 0 })
);

const TransportCycle = Schema.Tuple([
  WeightedTransportOutcome,
  WeightedTransportOutcome,
  WeightedTransportOutcome,
]);

const observation = (
  route: string,
  status: number,
  observedAt = 0,
  accept = "text/html"
): WatchObservation => ({
  accept,
  body: "",
  content: true,
  observedAt,
  route,
  status,
});

const transportError = (request: HttpClientRequest.HttpClientRequest) => {
  // @effect-diagnostics-next-line unstableApiUsage:off -- The supplied client models the pinned HTTP transport failure without using a network.
  const reason = new HttpClientError.TransportError({ request });

  // @effect-diagnostics-next-line unstableApiUsage:off -- The pinned client requires its typed error wrapper at this test boundary.
  return new HttpClientError.HttpClientError({ reason });
};

it.prop(
  "generated cycle histories distinguish HTTP failures, persistent transport and consecutive unreachable cycles",
  {
    history: Schema.Array(Cycle).check(
      Schema.isMinLength(1),
      Schema.isMaxLength(20)
    ),
  },
  ({ history }) => {
    let evidence: WatchEvidence = { cycles: 0, observations: [], routes: [] };

    for (const [index, cycle] of history.entries()) {
      const observations = cycle.flatMap((status, route) =>
        status === -1 ? [] : [observation(`/r/${route}`, status, index)]
      );

      evidence = nextWatchEvidence(evidence, observations);

      const recent = history.slice(
        Math.max(0, index + 1 - transportFailureCycles),
        index + 1
      );

      const completeWindow = recent.length === transportFailureCycles;
      const httpFailed = cycle.some((status) => status > 0 && status !== 200);

      const unreachable =
        completeWindow &&
        recent.every(
          (rows) =>
            rows.some((status) => status !== -1) &&
            rows.every((status) => status === -1 || status === 0)
        );

      const persistent =
        completeWindow &&
        cycle.some((_, route) => recent.every((rows) => rows[route] === 0));

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

it.prop(
  "healthy-weighted transport histories reset only the recovered route and require consecutive failures",
  {
    draws: Schema.Array(TransportCycle).check(
      Schema.isMinLength(5),
      Schema.isMaxLength(80)
    ),
  },
  ({ draws }) => {
    const history = draws.map((cycle) =>
      cycle.map((draw) => (draw === 0 ? 0 : 200))
    );

    let evidence: WatchEvidence = { cycles: 0, observations: [], routes: [] };

    for (const [index, cycle] of history.entries()) {
      evidence = nextWatchEvidence(evidence, [
        observation("/always-responds", 200, index),
        ...cycle.map((status, route) =>
          observation(`/r/${route}`, status, index)
        ),
      ]);
      const prefix = history.slice(0, index + 1);

      const trailingStreaks = cycle.map((_, route) => {
        const lastResponse = prefix
          .toReversed()
          .findIndex((rows) => rows[route] === 200);

        return lastResponse === -1 ? prefix.length : lastResponse;
      });

      for (const [route, expected] of trailingStreaks.entries()) {
        expect(evidence.transportStreaks?.[`/r/${route}`] ?? 0).toBe(expected);
      }

      const failed = trailingStreaks.some(
        (streak) => streak >= transportFailureCycles
      );

      expect(watchFailureReason(evidence)).toBe(
        failed ? "persistent-transport-failure" : undefined
      );

      if (failed) {
        break;
      }
    }
  },
  { arbitrary: { runs: 1000 } }
);

it.prop(
  "the completed-watch transport ratio rejects only rates strictly above its limit",
  {
    draw: Schema.Natural,
    scale: Schema.Int.check(Schema.isBetween({ maximum: 30, minimum: 1 })),
  },
  ({ scale, draw }) => {
    const total = scale * 20;

    for (const blips of [draw % (total + 1), scale, scale + 1]) {
      const observations = Array.from({ length: total }, (_, index) =>
        observation(`/r/${index}`, index < blips ? 0 : 200)
      );

      const evidence = nextWatchEvidence(
        { cycles: 0, observations: [], routes: [] },
        observations
      );

      expect(watchFailureReason(evidence)).toBeUndefined();
      expect(watchCompletionFailureReason(evidence)).toBe(
        blips / total > transportBlipRatioLimit
          ? "transport-blip-ratio"
          : undefined
      );
    }
  },
  { arbitrary: { runs: 500 } }
);

it("the November 7 incident remains green across 38 cycles, 244 routes and 15 transport blips", () => {
  const routes = Array.from({ length: 238 }, (_, index) => `/r/${index}`);

  let evidence: WatchEvidence = {
    cycles: 0,
    observations: [observation("/sitemap.xml", 200)],
    routes,
  };

  for (let cycle = 0; cycle < 38; cycle += 1) {
    const sampled = [
      ...fixedWatchRoutes.map((row) => row.route),
      ...Array.from(
        { length: 13 },
        (_, index) => routes[(cycle * 13 + index) % routes.length] ?? "/r/0"
      ),
    ];

    const observations = sampled.flatMap((route, index) =>
      ["*/*", "text/html"].map((accept, variant) => {
        const burst = cycle === 19 && index < fixedWatchRoutes.length;

        const scattered =
          variant === 0 &&
          ((cycle === 3 && index === 0) ||
            (cycle === 11 && index === 6) ||
            (cycle === 31 && index === 3));

        return observation(route, burst || scattered ? 0 : 200, cycle, accept);
      })
    );

    evidence = nextWatchEvidence(evidence, observations);
    expect(watchFailureReason(evidence)).toBeUndefined();
  }

  expect(evidence.cycles).toBe(38);
  expect(evidence.observations).toHaveLength(1445);
  expect(new Set(evidence.observations.map((row) => row.route)).size).toBe(244);
  expect(evidence.observations.filter((row) => row.status === 0)).toHaveLength(
    15
  );
  expect(watchCompletionFailureReason(evidence)).toBeUndefined();

  const responded = new Set(
    evidence.observations.flatMap((row) =>
      row.status === 200 ? [row.route] : []
    )
  );

  expect(routes.every((route) => responded.has(route))).toBe(true);
});

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
  transport: (path: string, attempt: number, accept: string) => boolean,
  routes: readonly string[] = ["/r/0"]
) => {
  const attempts = new Map<string, number>();

  return HttpClient.make((request) =>
    Effect.suspend(() => {
      const path = new URL(request.url).pathname;
      const accept = request.headers.accept ?? "";
      const key = `${path}:${accept}`;
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);

      if (transport(path, attempt, accept)) {
        return Effect.fail(transportError(request));
      }

      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(
            path === "/sitemap.xml"
              ? `<urlset>${routes.map((route) => `<url><loc>https://example.test${route}</loc></url>`).join("")}</urlset>`
              : "ok"
          )
        )
      );
    })
  );
};

const runWatch = Effect.fn("runWatch")(function* runWatch(
  client: HttpClient.HttpClient,
  timing?: { readonly durationMs: number; readonly intervalMs: number }
) {
  const fiber = yield* watchDeployment(
    "https://example.test",
    timing?.durationMs ?? 3000,
    timing?.intervalMs ?? 10
  ).pipe(
    Effect.provideService(HttpClient.HttpClient, client),
    Effect.result,
    Effect.forkChild
  );

  yield* TestClock.adjust(20_000);

  return yield* Fiber.join(fiber);
});

it.effect("the running watch preserves isolated transport blips", () =>
  Effect.gen(function* isolated() {
    const result = yield* runWatch(
      transportSite((path, attempt) => path === "/" && attempt <= 3)
    );

    expect(Result.isSuccess(result)).toBe(true);

    if (Result.isSuccess(result)) {
      expect(
        result.success.observations.filter((row) => row.status === 0)
      ).toHaveLength(2);
    }
  })
);

it.effect(
  "the running watch fails a route after consecutive transport cycles",
  () =>
    Effect.gen(function* persistent() {
      const result = yield* runWatch(transportSite((path) => path === "/"));
      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("persistent-transport-failure");
        expect(result.failure.evidence.cycles).toBe(transportFailureCycles);
      }
    })
);

it.effect("the dead-site policy is pinned to exactly two failed cycles", () =>
  Effect.gen(function* literalThreshold() {
    const result = yield* runWatch(
      transportSite(() => true),
      { durationMs: 10_000, intervalMs: 10 }
    );

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.evidence.cycles).toBe(2);
      expect(["persistent-transport-failure", "cycle-unreachable"]).toContain(
        result.failure.reason
      );
    }
  })
);

it.effect("the running watch requires consecutive unreachable cycles", () =>
  Effect.gen(function* unreachable() {
    const result = yield* runWatch(transportSite(() => true));
    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("cycle-unreachable");
      expect(result.failure.evidence.cycles).toBe(transportFailureCycles);
    }
  })
);

it.effect(
  "one unreachable cycle followed by healthy cycles does not fail the watch",
  () =>
    Effect.gen(function* recovered() {
      const result = yield* runWatch(
        transportSite(
          (_, attempt, accept) => accept !== "application/xml" && attempt <= 3
        )
      );

      expect(Result.isSuccess(result)).toBe(true);

      if (Result.isSuccess(result)) {
        expect(result.success.cycles).toBeGreaterThan(transportFailureCycles);
        expect(result.success.unreachableStreak).toBe(0);
      }
    })
);

it.effect(
  "a completed sweep fails coverage when a route never returned a real response",
  () =>
    Effect.gen(function* uncovered() {
      const routes = Array.from({ length: 37 }, (_, index) => `/r/${index}`);

      const result = yield* runWatch(
        transportSite((path) => path === "/r/0", routes),
        { durationMs: 4000, intervalMs: 200 }
      );

      expect(Result.isFailure(result)).toBe(true);

      if (Result.isFailure(result)) {
        const { evidence } = result.failure;
        expect(result.failure.reason).toBe("route-coverage-incomplete");
        expect(evidence.cycles).toBeGreaterThan(transportFailureCycles);
        expect(
          evidence.observations.some(
            (row) => row.route === "/r/0" && row.status !== 0
          )
        ).toBe(false);

        const responded = new Set(
          evidence.observations.flatMap((row) =>
            row.status === 200 ? [row.route] : []
          )
        );

        expect(routes.filter((route) => !responded.has(route))).toStrictEqual([
          "/r/0",
        ]);
      }
    })
);

it.effect("the watch rejects frequent alternating transport blips", () =>
  Effect.gen(function* ratio() {
    const result = yield* runWatch(
      transportSite((path, attempt) => path === "/" && attempt % 4 !== 0)
    );

    expect(Result.isFailure(result)).toBe(true);

    if (Result.isFailure(result)) {
      expect(result.failure.reason).toBe("transport-blip-ratio");
      expect(result.failure.evidence.transportFailure).not.toBe(
        "persistent-transport-failure"
      );
    }
  })
);

it.effect.prop(
  "alternating full outages fail the running watch before its deadline",
  {
    durationMs: Schema.Int.check(
      Schema.isBetween({ maximum: 60_000, minimum: 20_000 })
    ),
    intervalMs: Schema.Int.check(
      Schema.isBetween({ maximum: 500, minimum: 100 })
    ),
  },
  ({ durationMs, intervalMs }) =>
    Effect.gen(function* alternatingOutage() {
      const startedAt = yield* Clock.currentTimeMillis;

      const client = transportSite(
        (_, attempt, accept) =>
          accept !== "application/xml" && attempt % 4 !== 0
      );

      const fiber = yield* watchDeployment(
        "https://example.test",
        durationMs,
        intervalMs
      ).pipe(
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.result,
        Effect.flatMap((result) =>
          Clock.currentTimeMillis.pipe(
            Effect.map((settledAt) => ({ result, settledAt }))
          )
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust(durationMs + 10_000);
      const { result, settledAt } = yield* Fiber.join(fiber);

      expect(Result.isFailure(result)).toBe(true);
      expect(settledAt).toBeLessThan(startedAt + durationMs);

      if (Result.isFailure(result)) {
        expect(result.failure.reason).toBe("transport-blip-ratio");
        expect(result.failure.evidence.cycles).toBeGreaterThan(1);

        const probes = 2 * (fixedWatchRoutes.length + 1);

        for (
          let cycle = 0;
          cycle < result.failure.evidence.cycles;
          cycle += 1
        ) {
          const rows = result.failure.evidence.observations.slice(
            1 + cycle * probes,
            1 + (cycle + 1) * probes
          );

          expect(rows.map((row) => row.status)).toStrictEqual(
            Array.from({ length: probes }, () => (cycle % 2 === 0 ? 0 : 200))
          );
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
