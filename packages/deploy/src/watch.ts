import { watchActor } from "@rat-stack/capability/actor-watch";
import type { Verdict } from "@rat-stack/check-harness";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import {
  Clock,
  Effect,
  Option,
  Result,
  Schedule,
  Schema,
  Stream,
} from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { types } from "xstate";

export const WatchObservationSchema = Schema.Struct({
  accept: Schema.String,
  body: Schema.String,
  cfRay: Schema.optional(Schema.String),
  content: Schema.Boolean,
  incidentId: Schema.optional(Schema.String),
  observedAt: Schema.Natural,
  route: Schema.String,
  status: Schema.Natural,
});

export type WatchObservation = typeof WatchObservationSchema.Type;

export const WatchEvidenceSchema = Schema.Struct({
  cycles: Schema.Natural,
  observations: Schema.Array(WatchObservationSchema),
  routes: Schema.Array(Schema.String),
  streak: Schema.Natural,
});

export type WatchEvidence = typeof WatchEvidenceSchema.Type;

export class WatchFailed extends Schema.TaggedError<WatchFailed>()(
  "WatchFailed",
  {
    evidence: WatchEvidenceSchema,
    reason: Schema.String,
  }
) {}

export const failureBodyBytes = 4096;

const isUnprintable = (codePoint: number) =>
  (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a) ||
  (codePoint >= 0x7f && codePoint <= 0x9f);

export const printableBody = (bytes: Uint8Array) =>
  Array.from(new TextDecoder().decode(bytes), (character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return isUnprintable(codePoint)
      ? `\\u${codePoint.toString(16).padStart(4, "0")}`
      : character;
  }).join("");

export const nextWatchEvidence = (
  previous: WatchEvidence,
  observations: readonly WatchObservation[]
): WatchEvidence => ({
  ...previous,
  cycles: previous.cycles + 1,
  observations: [...previous.observations, ...observations],
  streak: observations.some((row) => row.content && row.status === 500)
    ? previous.streak + 1
    : 0,
});

export const fixedWatchRoutes = [
  { content: true, route: "/" },
  { content: true, route: "/llms.txt" },
  { content: true, route: "/sitemap.xml" },
  { content: true, route: "/auth.md" },
  { content: true, route: "/lore/effect-basics" },
  { content: false, route: "/.well-known/mcp.json" },
] as const;

export const sweepSlice = (
  routes: readonly string[],
  cycle: number,
  sweepCycles: number
): readonly string[] => {
  if (routes.length === 0) {
    return [];
  }

  const size = Math.ceil(routes.length / sweepCycles);
  const start = (cycle * size) % routes.length;

  return [...routes, ...routes].slice(
    start,
    start + Math.min(size, routes.length)
  );
};

export const sitemapRoutes = (
  baseUrl: string,
  sitemap: string
): readonly string[] => {
  const { origin } = new URL(baseUrl);
  const fixed = new Set<string>(fixedWatchRoutes.map((row) => row.route));
  const routes = new Set<string>();

  for (const match of sitemap.matchAll(/<loc>\s*(?<loc>[^<\s]+)\s*<\/loc>/gu)) {
    const loc = match.groups?.loc;
    const url = loc === undefined ? undefined : URL.parse(loc);

    if (url !== undefined && url !== null && url.origin === origin) {
      const route = `${url.pathname}${url.search}`;

      if (!fixed.has(route)) {
        routes.add(route);
      }
    }
  }

  return [...routes];
};

const WatchInputSchema = Schema.Struct({
  baseUrl: Schema.String,
  deadline: Schema.Natural,
  intervalMs: Schema.Natural,
  sweepCycles: Schema.Int.check(Schema.isGreaterThan(0)),
  threshold: Schema.Int.check(Schema.isGreaterThan(0)),
});

type WatchInput = typeof WatchInputSchema.Type;

const WatchCycleInputSchema = Schema.Struct({
  ...WatchInputSchema.fields,
  routes: Schema.Array(Schema.String),
});

type WatchCycleInput = typeof WatchCycleInputSchema.Type;

interface WatchContext {
  readonly evidence: WatchEvidence;
  readonly input: WatchInput;
}

interface WatchRequest {
  readonly accept: string;
  readonly content: boolean;
  readonly route: string;
}

export const probeTimeoutMs = 15_000;

const probeRoute = Effect.fn("probeRoute")(function* probeRoute(
  baseUrl: string,
  request: WatchRequest
) {
  const client = yield* HttpClient.HttpClient;
  const observedAt = yield* Clock.currentTimeMillis;
  const separator = request.route.includes("?") ? "&" : "?";

  return yield* Effect.gen(function* readResponse() {
    const response = yield* client.execute(
      HttpClientRequest.get(
        `${baseUrl.replace(/\/$/u, "")}${request.route}${separator}__rat_watch=${observedAt}`
      ).pipe(HttpClientRequest.setHeader("accept", request.accept))
    );

    const bytes =
      response.status === 200
        ? []
        : yield* response.stream.pipe(
            Stream.flatMap((chunk) => Stream.fromIterable(chunk)),
            Stream.take(failureBodyBytes),
            Stream.runCollect
          );

    const observation = {
      ...request,
      body: printableBody(new Uint8Array(bytes)),
      cfRay: response.headers["cf-ray"],
      incidentId: response.headers["x-incident-id"],
      observedAt,
      status: response.status,
    } satisfies WatchObservation;

    return { observation, response };
  }).pipe(
    Effect.timeout(probeTimeoutMs),
    Effect.map(({ observation, response }) => ({
      observation,
      response: Option.some(response),
    })),
    Effect.orElseSucceed(() => ({
      observation: {
        ...request,
        body: "transport-or-body-read-unavailable",
        observedAt,
        status: 0,
      } satisfies WatchObservation,
      response: Option.none(),
    }))
  );
});

const logFailures = (observations: readonly WatchObservation[]) =>
  Effect.forEach(
    observations.filter((row) => row.status !== 200),
    (observation) =>
      Effect.logWarning("deploy-watch-first-class-evidence", observation),
    { discard: true }
  );

export const discoverWatchRoutes = Effect.fn("discoverWatchRoutes")(
  function* discoverWatchRoutes(input: WatchInput) {
    const { observation, response } = yield* probeRoute(input.baseUrl, {
      accept: "application/xml",
      content: true,
      route: "/sitemap.xml",
    });

    yield* logFailures([observation]);

    if (Option.isNone(response) || observation.status !== 200) {
      return { observation, routes: [] };
    }

    const sitemap = yield* response.value.text.pipe(
      Effect.timeout(probeTimeoutMs),
      Effect.orElseSucceed(() => "")
    );

    return { observation, routes: sitemapRoutes(input.baseUrl, sitemap) };
  },
  Effect.scoped
);

export const observeWatchCycle = Effect.fn("observeWatchCycle")(
  function* observeWatchCycle(input: WatchCycleInput) {
    const now = yield* Clock.currentTimeMillis;

    if (now >= input.deadline) {
      return { finished: true, observations: [] };
    }

    const routes = [
      ...fixedWatchRoutes,
      ...input.routes.map((route) => ({ content: true, route })),
    ];

    const requests = routes.flatMap((route) =>
      ["*/*", "text/html"].map((accept) => ({ ...route, accept }))
    );

    const observations = yield* Effect.forEach(
      requests,
      (request) =>
        probeRoute(input.baseUrl, request).pipe(
          Effect.map((probe) => probe.observation)
        ),
      { concurrency: 12 }
    );

    yield* logFailures(observations);

    return { finished: false, observations };
  },
  Effect.scoped
);

const discover = fromEffect({
  effect: ({ input }) => discoverWatchRoutes(input),
  schemas: { input: WatchInputSchema },
});

const observe = fromEffect({
  effect: ({ input }) => observeWatchCycle(input),
  schemas: { input: WatchCycleInputSchema },
});

const wait = fromEffect({
  effect: ({ input }) =>
    Effect.gen(function* waitForCycle() {
      const remaining = Math.max(
        0,
        input.deadline - (yield* Clock.currentTimeMillis)
      );

      yield* Effect.void.pipe(
        Effect.repeat({
          schedule: Schedule.spaced(Math.min(input.intervalMs, remaining)),
          times: 1,
        })
      );
    }),
  schemas: { input: WatchInputSchema },
});

export const watchMachine = setupEffect({
  actors: { discover, observe, wait },
  schemas: { context: types<WatchContext>(), input: WatchInputSchema },
}).createMachine({
  context: ({ input }) => ({
    evidence: { cycles: 0, observations: [], routes: [], streak: 0 },
    input,
  }),
  initial: "discovering",
  output: ({ context }) => context.evidence,
  states: {
    completed: { type: "final" },
    discovering: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: ({ context, event }) => ({
          context: {
            evidence: {
              ...context.evidence,
              observations: [event.output.observation],
              routes: event.output.routes,
            },
          },
          target: "observing",
        }),
        src: "discover",
      },
    },
    failed: { type: "final" },
    observing: {
      invoke: {
        input: ({ context }) => ({
          ...context.input,
          routes: sweepSlice(
            context.evidence.routes,
            context.evidence.cycles,
            context.input.sweepCycles
          ),
        }),
        onDone: ({ context, event }) => {
          const evidence = event.output.finished
            ? context.evidence
            : nextWatchEvidence(context.evidence, event.output.observations);

          let target = event.output.finished ? "completed" : "waiting";

          if (evidence.streak >= context.input.threshold) {
            target = "failed";
          }

          return { context: { evidence }, target };
        },
        src: "observe",
      },
    },
    waiting: {
      invoke: {
        input: ({ context }) => context.input,
        onDone: { target: "observing" },
        src: "wait",
      },
    },
  },
});

export const watchDefaults = { durationMs: 600_000, intervalMs: 10_000 };

export const watchDeployment = Effect.fn("watchDeployment")(
  function* watchDeployment(
    baseUrl: string,
    durationMs?: number,
    intervalMs?: number
  ) {
    const now = yield* Clock.currentTimeMillis;
    const duration = durationMs ?? watchDefaults.durationMs;
    const interval = intervalMs ?? watchDefaults.intervalMs;

    const actor = yield* createEffectActor(watchMachine, {
      input: {
        baseUrl,
        deadline: now + duration,
        intervalMs: interval,
        sweepCycles: Math.max(
          1,
          Math.floor(duration / Math.max(1, interval) / 3)
        ),
        threshold: 2,
      },
    });

    yield* watchActor("watchMachine", actor);

    // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected watch actor failures remain defects rather than a passing observation.
    const evidence = yield* join(actor).pipe(
      Effect.orDie,
      Effect.flatMap(Schema.decodeUnknownEffect(WatchEvidenceSchema)),
      Effect.orDie
    );

    if (
      evidence.cycles === 0 ||
      evidence.observations.some((row) => row.status !== 200)
    ) {
      return yield* new WatchFailed({
        evidence,
        reason:
          evidence.streak >= 2
            ? "consecutive-content-500-cycles"
            : "non-200-or-incomplete-watch",
      });
    }

    if (evidence.routes.length === 0) {
      return yield* new WatchFailed({
        evidence,
        reason: "sitemap-listed-no-routes",
      });
    }

    const observed = new Set(evidence.observations.map((row) => row.route));

    if (evidence.routes.some((route) => !observed.has(route))) {
      return yield* new WatchFailed({
        evidence,
        reason: "route-coverage-incomplete",
      });
    }

    return evidence;
  },
  Effect.scoped
);

export const watchVerdict = Effect.fn("watchVerdict")(function* watchVerdict(
  baseUrl: string
) {
  const result = yield* watchDeployment(baseUrl).pipe(Effect.result);

  const evidence = Result.isSuccess(result)
    ? result.success
    : result.failure.evidence;

  const failed = Result.isFailure(result);

  const rejected = evidence.observations.flatMap((row, index) =>
    row.status === 200 ? [] : [{ index, row }]
  );

  return {
    check: "post-deploy-watch",
    control: 1,
    counts: {
      cycles: evidence.cycles,
      nonOk: rejected.length,
      observed: evidence.observations.length,
      routes: evidence.routes.length,
    },
    observedAt: yield* Clock.currentTimeMillis,
    provenance: rejected.map(({ index, row }) => ({
      fetchedAt: row.observedAt,
      id: `watch:${index}`,
      source: `${baseUrl}${row.route}`,
      status: JSON.stringify(row),
    })),
    reason: failed
      ? `WatchFailed:${result.failure.reason}`
      : "bounded-watch-confirmed",
    ...(failed
      ? { exitCode: 2, outcome: "failed", status: "red" }
      : { exitCode: 0, outcome: "passed", status: "green" }),
  } satisfies Verdict;
});
