import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Result, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TestClock } from "effect/testing";

import {
  fixedWatchRoutes,
  nextWatchEvidence,
  printableBody,
  sitemapRoutes,
  sweepSlice,
  watchDeployment,
  watchVerdict,
} from "../src/watch.js";
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
      let evidence: WatchEvidence = {
        cycles: 0,
        observations: [],
        routes: [],
        streak: 0,
      };

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

it.prop(
  "one sweep of cycles probes every sitemap route",
  {
    count: Schema.Int.check(Schema.isBetween({ maximum: 400, minimum: 0 })),
    offset: Schema.Int.check(Schema.isBetween({ maximum: 500, minimum: 0 })),
    sweepCycles: Schema.Int.check(
      Schema.isBetween({ maximum: 60, minimum: 1 })
    ),
  },
  ({ count, offset, sweepCycles }) => {
    const routes = Array.from({ length: count }, (_, index) => `/r/${index}`);
    const probed = new Set<string>();

    for (let cycle = offset; cycle < offset + sweepCycles; cycle += 1) {
      const slice = sweepSlice(routes, cycle, sweepCycles);
      expect(slice.length).toBeLessThanOrEqual(Math.ceil(count / sweepCycles));

      for (const route of slice) {
        probed.add(route);
      }
    }

    expect(probed.size).toBe(
      offset % sweepCycles === 0 || count === 0 ? count : probed.size
    );

    if (offset === 0) {
      expect([...probed].toSorted()).toStrictEqual(routes.toSorted());
    }
  },
  { arbitrary: { runs: 300 } }
);

const Loc = Schema.Struct({
  foreign: Schema.Boolean,
  path: Schema.Literals([
    "/",
    "/llms.txt",
    "/AGENTS.md",
    "/lore/effect-basics",
    "/lore/fence",
    "/systems/auth",
    "/learn",
    "/log",
  ]),
});

it.prop(
  "sitemap discovery keeps each same-origin route once and leaves fixed routes to every cycle",
  { locs: Schema.Array(Loc).check(Schema.isMaxLength(40)) },
  ({ locs }) => {
    const xml = `<urlset>${locs
      .map(
        (loc) =>
          `<url><loc>${loc.foreign ? "https://elsewhere.test" : "https://example.test"}${loc.path}</loc></url>`
      )
      .join("\n")}</urlset>`;

    const fixed = new Set<string>(fixedWatchRoutes.map((row) => row.route));

    const expected = [
      ...new Set(
        locs.flatMap((loc) =>
          loc.foreign || fixed.has(loc.path) ? [] : [loc.path]
        )
      ),
    ];

    expect(sitemapRoutes("https://example.test/", xml)).toStrictEqual(expected);
  },
  { arbitrary: { runs: 200 } }
);

const sitemap = (routes: readonly string[]) =>
  `<urlset>${routes
    .map((route) => `<url><loc>https://example.test${route}</loc></url>`)
    .join("")}</urlset>`;

const site = (
  routes: readonly string[],
  failing: (path: string) => boolean,
  requests: { readonly accept: string; readonly path: string }[],
  latencyMs = 0
) =>
  HttpClient.make((request) => {
    const path = new URL(request.url).pathname;
    requests.push({ accept: request.headers.accept ?? "missing", path });

    if (path === "/sitemap.xml") {
      return Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(sitemap(routes)))
      );
    }

    return Effect.as(
      Effect.sleep(latencyMs),
      HttpClientResponse.fromWeb(
        request,
        failing(path)
          ? new Response("x".repeat(10_000), {
              headers: {
                "cf-ray": "ray-first",
                "x-incident-id": "incident-first",
              },
              status: 500,
            })
          : new Response("ok")
      )
    );
  });

it.effect(
  "a clean watch probes every sitemap route under both accept headers",
  () =>
    Effect.gen(function* testCoverage() {
      const routes = Array.from({ length: 37 }, (_, index) => `/r/${index}`);
      const requests: { readonly accept: string; readonly path: string }[] = [];

      const fiber = yield* watchDeployment(
        "https://example.test",
        300,
        10
      ).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(routes, () => false, requests)
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust(1000);
      const evidence = yield* Fiber.join(fiber);

      expect(evidence.routes).toStrictEqual(routes);

      for (const route of routes) {
        for (const accept of ["*/*", "text/html"]) {
          expect(
            requests.some((row) => row.path === route && row.accept === accept)
          ).toBe(true);
        }
      }
    })
);

it.effect(
  "a watch that runs out of time before sweeping every route fails as incomplete",
  () =>
    Effect.gen(function* testIncomplete() {
      const routes = Array.from({ length: 37 }, (_, index) => `/r/${index}`);

      const fiber = yield* watchDeployment(
        "https://example.test",
        300,
        10
      ).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(routes, () => false, [], 50)
        ),
        Effect.flip,
        Effect.forkChild
      );

      yield* TestClock.adjust(1000);
      const failure = yield* Fiber.join(fiber);

      expect(failure.reason).toBe("route-coverage-incomplete");
      expect(failure.evidence.routes).toStrictEqual(routes);
    })
);

it.effect(
  "two failing cycles stop early and retain first incident and bounded body",
  () =>
    Effect.gen(function* testWatch() {
      const requests: { readonly accept: string; readonly path: string }[] = [];

      const client = site(["/r/0", "/r/1"], (path) => path === "/", requests);

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

        const failure = result.failure.evidence.observations.find(
          (row) => row.status === 500
        );

        expect(failure?.incidentId).toBe("incident-first");
        expect(failure?.cfRay).toBe("ray-first");
        expect(failure?.body).toHaveLength(4096);
      }

      expect(requests.filter((row) => row.path === "/")).toHaveLength(4);
      expect(new Set(requests.map((row) => row.accept))).toStrictEqual(
        new Set(["application/xml", "*/*", "text/html"])
      );
    })
);

const controlCodes = new Set([
  ...Array.from({ length: 32 }, (_, code) => code).filter(
    (code) => code !== 9 && code !== 10
  ),
  ...Array.from({ length: 33 }, (_, offset) => 127 + offset),
]);

const unprintable = {
  test: (text: string) =>
    Array.from(
      { length: text.length },
      (_, index) => text.codePointAt(index) ?? 0
    ).some((code) => controlCodes.has(code)),
};

const failingProbe = (path: string) => path === "/r/4" || path === "/auth.md";

it.prop(
  "a stored body never holds a control character other than newline or tab",
  {
    bytes: Schema.Array(
      Schema.Int.check(Schema.isBetween({ maximum: 255, minimum: 0 }))
    ).check(Schema.isMaxLength(64)),
  },
  ({ bytes }) => {
    const raw = new TextDecoder().decode(new Uint8Array(bytes));
    const body = printableBody(new Uint8Array(bytes));

    expect(unprintable.test(body)).toBe(false);
    expect(body === raw).toBe(!unprintable.test(raw));
  },
  { arbitrary: { runs: 500 } }
);

it.effect(
  "the watch verdict keeps every rejected probe and only rejected probes",
  () =>
    Effect.gen(function* testRejected() {
      const routes = Array.from({ length: 12 }, (_, index) => `/r/${index}`);
      const requests: { readonly accept: string; readonly path: string }[] = [];

      const fiber = yield* watchVerdict("https://example.test").pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          site(routes, failingProbe, requests)
        ),
        Effect.forkChild
      );

      yield* TestClock.adjust(11 * 60_000);
      const verdict = yield* Fiber.join(fiber);
      const rejected = requests.filter((row) => failingProbe(row.path)).length;

      expect(rejected).toBeGreaterThan(0);
      expect(verdict.provenance).toHaveLength(rejected);
      expect(verdict.counts.nonOk).toBe(rejected);
      expect(verdict.counts.observed).toBeGreaterThan(rejected);

      for (const row of verdict.provenance ?? []) {
        expect(row.status).toContain('"status":500');
        expect(row.status).toContain('"cfRay":"ray-first"');
      }
    })
);
