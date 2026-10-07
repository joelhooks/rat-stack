import { watchActor } from "@rat-stack/capability/actor-watch";
import type { Verdict } from "@rat-stack/check-harness";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Clock, Effect, Result, Schedule, Schema, Stream } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import { types } from "xstate";

export const WatchObservationSchema = Schema.Struct({
  accept: Schema.String,
  body: Schema.String,
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

export const nextWatchEvidence = (
  previous: WatchEvidence,
  observations: readonly WatchObservation[]
): WatchEvidence => ({
  cycles: previous.cycles + 1,
  observations: [...previous.observations, ...observations],
  streak: observations.some((row) => row.content && row.status === 500)
    ? previous.streak + 1
    : 0,
});

const WatchInputSchema = Schema.Struct({
  baseUrl: Schema.String,
  deadline: Schema.Natural,
  intervalMs: Schema.Natural,
  threshold: Schema.Int.check(Schema.isGreaterThan(0)),
});

type WatchInput = typeof WatchInputSchema.Type;

interface WatchContext {
  readonly evidence: WatchEvidence;
  readonly input: WatchInput;
}

export const observeWatchCycle = Effect.fn("observeWatchCycle")(
  function* observeWatchCycle(input: WatchInput) {
    const client = yield* HttpClient.HttpClient;
    const now = yield* Clock.currentTimeMillis;

    if (now >= input.deadline) {
      return { finished: true, observations: [] };
    }

    const routes = [
      { content: true, route: "/" },
      { content: true, route: "/llms.txt" },
      { content: true, route: "/sitemap.xml" },
      { content: true, route: "/auth.md" },
      { content: true, route: "/lore/effect-basics" },
      { content: false, route: "/.well-known/mcp.json" },
    ];

    const requests = routes.flatMap((route) =>
      ["*/*", "text/html"].map((accept) => ({ ...route, accept }))
    );

    const observations = yield* Effect.forEach(
      requests,
      (request) =>
        Effect.gen(function* probe() {
          const observedAt = yield* Clock.currentTimeMillis;
          const remaining = Math.max(1, input.deadline - observedAt);

          return yield* Effect.gen(function* readResponse() {
            const response = yield* client.execute(
              HttpClientRequest.get(
                `${input.baseUrl.replace(/\/$/u, "")}${request.route}?__rat_watch=${observedAt}`
              ).pipe(HttpClientRequest.setHeader("accept", request.accept))
            );

            const bytes =
              response.status === 200
                ? []
                : yield* response.stream.pipe(
                    Stream.flatMap((chunk) => Stream.fromIterable(chunk)),
                    Stream.take(300),
                    Stream.runCollect
                  );

            const incidentId = response.headers["x-incident-id"];

            return {
              ...request,
              body: new TextDecoder().decode(new Uint8Array(bytes)),
              incidentId,
              observedAt,
              status: response.status,
            } satisfies WatchObservation;
          }).pipe(
            Effect.timeout(Math.min(15_000, remaining)),
            Effect.orElseSucceed(
              () =>
                ({
                  ...request,
                  body: "transport-or-body-read-unavailable",
                  observedAt,
                  status: 0,
                }) satisfies WatchObservation
            )
          );
        }),
      { concurrency: 12 }
    );

    for (const observation of observations.filter(
      (row) => row.status !== 200
    )) {
      yield* Effect.logWarning(
        "deploy-watch-first-class-evidence",
        observation
      );
    }

    return { finished: false, observations };
  },
  Effect.scoped
);

const observe = fromEffect({
  effect: ({ input }) => observeWatchCycle(input),
  schemas: { input: WatchInputSchema },
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
  actors: { observe, wait },
  schemas: { context: types<WatchContext>(), input: WatchInputSchema },
}).createMachine({
  context: ({ input }) => ({
    evidence: { cycles: 0, observations: [], streak: 0 },
    input,
  }),
  initial: "observing",
  output: ({ context }) => context.evidence,
  states: {
    completed: { type: "final" },
    failed: { type: "final" },
    observing: {
      invoke: {
        input: ({ context }) => context.input,
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
    const deadline = now + (durationMs ?? watchDefaults.durationMs);

    const actor = yield* createEffectActor(watchMachine, {
      input: {
        baseUrl,
        deadline,
        intervalMs: intervalMs ?? watchDefaults.intervalMs,
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

  return {
    check: "post-deploy-watch",
    control: 1,
    counts: { cycles: evidence.cycles, observed: evidence.observations.length },
    observedAt: yield* Clock.currentTimeMillis,
    provenance: evidence.observations.map((row, index) => ({
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
