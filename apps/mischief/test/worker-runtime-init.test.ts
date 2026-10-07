import { expect, it } from "@effect/vitest";
import { InterestDirectory } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import { ConfigProvider, Effect, Layer } from "effect";
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
      throw new Error("The runtime-init request must not invoke the sandbox");
    },
  } satisfies WorkerLoaderBinding,
  WEBSITE: {
    // oxlint-disable-next-line typescript/promise-function-async -- The Website stub implements a native service binding.
    fetch: () =>
      Promise.resolve(
        new Response("Foldkit", {
          headers: { "content-type": "text/html", "x-reader": "true" },
        })
      ),
  },
};

const unavailableLegacyMcp = {
  forward: () => Effect.die(new Error("Unexpected legacy MCP request")),
} satisfies NonNullable<MischiefRouteOptions["legacyMcp"]>;

const runtimeBaseServices = Layer.mergeAll(
  Layer.succeed(Cloudflare.Workers.WorkerEnvironment, workerEnvironment),
  ConfigProvider.layer(ConfigProvider.fromUnknown({}))
);

const runtimeServices = Layer.provideMerge(
  Cloudflare.Workers.RateLimitBinding,
  runtimeBaseServices
);

it.effect(
  "starts the Worker and serves a request without deploy-time services",
  () =>
    Effect.acquireUseRelease(
      Effect.sync(() => {
        const previous = globalThis.__ALCHEMY_RUNTIME__;
        globalThis.__ALCHEMY_RUNTIME__ = true;

        return previous;
      }),
      () =>
        Effect.gen(function* runtimeRequest() {
          yield* Effect.addFinalizer(() =>
            Effect.promise(disposeFixtureAssets)
          );

          const erasedWorkerInit: unknown = makeMischief(
            unavailableLegacyMcp,
            InterestDirectory.memory
          ).pipe(Effect.provide(runtimeServices));

          // SAFETY: runtimeServices provides the bindings Alchemy erases from the init effect type.
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- runtimeServices provides the Worker init bindings.
          const workerInit = erasedWorkerInit as InitializedMischief;
          const worker = yield* workerInit;

          const handler = Cloudflare.Workers.makeRequestHandler(worker.fetch);

          for (const [path, accept, status, reader] of [
            ["/not-a-route", "*/*", 404, null],
            ["/", "text/html", 200, "true"],
            ["/", "*/*", 200, null],
            ["/", "text/markdown", 200, null],
            ["/assets/x.js", "*/*", 200, "true"],
            ["/llms.txt", "text/html", 200, null],
          ] as const) {
            const responseEffect: unknown = handler({
              context: {},
              env: workerEnvironment,
              input: new Request(`https://ratstack.sh${path}`, {
                headers: { accept },
              }),
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
            const typed = responseEffect as Effect.Effect<Response>;

            const response = yield* typed;

            expect(response.status).toBe(status);
            expect(response.headers.get("x-reader")).toBe(reader);

            if (path === "/" && reader === null) {
              expect(response.headers.get("content-type")).toContain(
                "text/markdown"
              );
              expect(
                yield* Effect.promise(response.text.bind(response))
              ).toContain("Rat Stack");
            }
          }

          return yield* Effect.void;
        }),
      (previous) =>
        Effect.sync(() => {
          globalThis.__ALCHEMY_RUNTIME__ = previous;
        })
    )
);
