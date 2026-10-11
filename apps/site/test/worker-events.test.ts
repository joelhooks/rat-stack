import { expect, it } from "@effect/vitest";
import { InterestDirectory } from "@rat-stack/core/interest";
import { RequestBodySchema } from "@rat-stack/events";
import { EventSinkMemory, memoryEventsLayer } from "@rat-stack/events/memory";
import * as Cloudflare from "alchemy/Cloudflare";
import { ConfigProvider, Effect, Layer, Option, Ref, Schema } from "effect";
import type { ConfigError } from "effect/Config";
import type * as Scope from "effect/Scope";

import type { MischiefRouteOptions } from "../src/app.js";
import type { RateLimitBindings } from "../src/rate-limits.js";
import type { WorkerLoaderBinding } from "../src/sandbox-worker-loader.js";
import { makeMischief } from "../src/worker.js";
import {
  disposeFixtureAssets,
  fetchFixtureAsset,
} from "./generated-content.js";

type InitializedMischief = Effect.Effect<
  { readonly fetch: Cloudflare.Workers.HttpEffect },
  ConfigError,
  Scope.Scope
>;

const rateLimit = {
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's binding returns a native Promise.
  limit: () => Promise.resolve({ success: true }),
};

const rateLimitBindings: RateLimitBindings = {
  API_PER_IP: rateLimit,
  EXECUTE_GLOBAL: rateLimit,
  EXECUTE_PER_IP: rateLimit,
  INTEREST_PER_IP: rateLimit,
};

const workerEnvironment = {
  ...rateLimitBindings,
  ASSETS: { fetch: fetchFixtureAsset },
  CODE_SANDBOX: {
    load: () => {
      throw new Error("The events request must not invoke the sandbox");
    },
  } satisfies WorkerLoaderBinding,
  WEBSITE: { fetch: fetchFixtureAsset },
};

const unavailableLegacyMcp = {
  forward: () => Effect.die(new Error("Unexpected legacy MCP request")),
} satisfies NonNullable<MischiefRouteOptions["legacyMcp"]>;

const runtimeServices = Layer.provideMerge(
  Cloudflare.Workers.RateLimitBinding,
  Layer.mergeAll(
    Layer.succeed(Cloudflare.Workers.WorkerEnvironment, workerEnvironment),
    ConfigProvider.layer(
      ConfigProvider.fromUnknown({ EVENTS_IDENTITY_MODE: "persistent" })
    )
  )
);

it.effect(
  "the deployed Worker records each request through waitUntil without changing the response",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = globalThis.__ALCHEMY_RUNTIME__;
        globalThis.__ALCHEMY_RUNTIME__ = true;

        return previous;
      }),
      () =>
        Effect.gen(function* recordThroughWorker() {
          yield* Effect.addFinalizer(() =>
            Effect.promise(disposeFixtureAssets)
          );

          const events = yield* Layer.build(memoryEventsLayer("worker-salt"));
          const backgroundRuns = yield* Ref.make(0);

          const execution = Cloudflare.WorkerExecutionContext.of({
            access: Effect.succeedNone.pipe(Effect.map(Option.getOrUndefined)),
            cache: {
              purge: () =>
                Effect.die(new Error("The events request must not purge")),
            },
            passThroughOnException: () => Effect.void,
            raw: {},
            waitUntil: (effect) =>
              Effect.andThen(
                Ref.update(backgroundRuns, (runs) => runs + 1),
                effect
              ).pipe(Effect.ignore),
          });

          const erasedWorkerInit: unknown = makeMischief(
            unavailableLegacyMcp,
            InterestDirectory.memory,
            events
          ).pipe(Effect.provide(runtimeServices));

          // SAFETY: runtimeServices provides the bindings Alchemy erases from the init effect type.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtimeServices provides the Worker init bindings.
          const workerInit = erasedWorkerInit as InitializedMischief;
          const worker = yield* workerInit;
          const handler = Cloudflare.Workers.makeRequestHandler(worker.fetch);

          const responseEffect: unknown = handler({
            context: {},
            env: workerEnvironment,
            input: new Request(
              "https://ratstack.sh/not-a-route?utm_source=x&token=secret",
              {
                headers: { accept: "text/html", host: "ratstack.sh" },
              }
            ),
            kind: "Cloudflare.Workers.WorkerEvent",
            type: "fetch",
          });

          if (responseEffect === undefined) {
            return yield* Effect.die(
              new Error("Worker fetch handler was absent")
            );
          }

          // SAFETY: Alchemy's handler provides request services before casting its response effect to any.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- makeRequestHandler erases its response effect type.
          const typedResponseEffect = responseEffect as Effect.Effect<Response>;

          const response = yield* typedResponseEffect.pipe(
            Effect.provideService(Cloudflare.WorkerExecutionContext, execution)
          );

          const recorded = yield* Effect.provideContext(
            Effect.gen(function* readRecorded() {
              return yield* (yield* EventSinkMemory).events;
            }),
            events
          );

          expect(response.status).toBe(404);
          expect(yield* Ref.get(backgroundRuns)).toBe(1);
          expect(recorded).toHaveLength(1);

          const body = yield* Schema.decodeUnknownEffect(RequestBodySchema)(
            recorded[0]?.body
          );

          expect(body.path).toBe("/not-a-route");
          expect(body.status).toBe(404);
          expect(body.query).toStrictEqual({ utm_source: ["x"] });

          return yield* Effect.void;
        }),
      (previous) =>
        Effect.sync(() => {
          globalThis.__ALCHEMY_RUNTIME__ = previous;
        })
    )
);
