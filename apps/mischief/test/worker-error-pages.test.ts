import { expect, it } from "@effect/vitest";
import { InterestDirectory } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import { ConfigProvider, Effect, Layer, Option, Schema } from "effect";
import type { ConfigError } from "effect/Config";
import type * as Scope from "effect/Scope";

import type { MischiefRouteOptions } from "../src/app.js";
import { ReaderErrorPage, readerErrorPath } from "../src/reader-error-page.js";
import type { WorkerLoaderBinding } from "../src/sandbox-worker-loader.js";
import { readerContentSecurityPolicy } from "../src/security.js";
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

type WebsiteMode = "renders" | "throws" | "wrong status" | "plain text";

const websiteMarker = '<main data-website-error="true">';

const rateLimit = {
  // oxlint-disable-next-line typescript/promise-function-async -- Cloudflare's binding returns a native Promise.
  limit: () => Promise.resolve({ success: true }),
};

const decodeErrorPage = Schema.decodeUnknownSync(
  Schema.fromJsonString(ReaderErrorPage)
);

const website = (mode: WebsiteMode, calls: string[]) => ({
  // @effect-diagnostics-next-line asyncFunction:off -- The fake WEBSITE binding implements the native Promise fetch API.
  fetch: async (request: Request) => {
    const { pathname } = new URL(request.url);
    calls.push(`${request.method} ${pathname}`);

    if (pathname !== readerErrorPath) {
      return new Response("This route is outside the reader preview slice", {
        status: 404,
      });
    }

    const page = decodeErrorPage(await request.text());

    if (mode === "throws") {
      throw new Error("The Website Worker is down");
    }

    return new Response(
      `<!doctype html><html><body>${websiteMarker}<span class="error-code">${page.code}</span> ${page.title}</main></body></html>`,
      {
        headers: {
          "content-type":
            mode === "plain text"
              ? "text/plain; charset=utf-8"
              : "text/html; charset=utf-8",
        },
        status: mode === "wrong status" ? 500 : page.code,
      }
    );
  },
});

const unavailableLegacyMcp = {
  forward: () => Effect.die(new Error("Unexpected legacy MCP request")),
} satisfies NonNullable<MischiefRouteOptions["legacyMcp"]>;

const requestThroughWorker = (
  mode: WebsiteMode,
  path: string,
  accept: string
) =>
  Effect.gen(function* throughWorker() {
    const calls: string[] = [];

    const workerEnvironment = {
      API_PER_IP: rateLimit,
      ASSETS: { fetch: fetchFixtureAsset },
      CODE_SANDBOX: {
        load: () => {
          throw new Error("An error page must not invoke the sandbox");
        },
      } satisfies WorkerLoaderBinding,
      EXECUTE_GLOBAL: rateLimit,
      EXECUTE_PER_IP: rateLimit,
      INTEREST_PER_IP: rateLimit,
      WEBSITE: website(mode, calls),
    };

    const erasedWorkerInit: unknown = makeMischief(
      unavailableLegacyMcp,
      InterestDirectory.memory
    ).pipe(
      Effect.provide(
        Layer.provideMerge(
          Cloudflare.Workers.RateLimitBinding,
          Layer.mergeAll(
            Layer.succeed(
              Cloudflare.Workers.WorkerEnvironment,
              workerEnvironment
            ),
            ConfigProvider.layer(ConfigProvider.fromUnknown({}))
          )
        )
      )
    );

    // SAFETY: the layer above provides the bindings Alchemy erases from the init effect type.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the layer above provides the Worker init bindings.
    const worker = yield* erasedWorkerInit as InitializedMischief;
    const handler = Cloudflare.Workers.makeRequestHandler(worker.fetch);

    const responseEffect: unknown = handler({
      context: {},
      env: workerEnvironment,
      input: new Request(`https://ratstack.sh${path}`, {
        headers: { accept, host: "ratstack.sh" },
      }),
      kind: "Cloudflare.Workers.WorkerEvent",
      type: "fetch",
    });

    // SAFETY: Alchemy's handler provides request services before casting its response effect to any.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- makeRequestHandler erases its response effect type.
    const response = yield* (responseEffect as Effect.Effect<Response>).pipe(
      Effect.provideService(
        Cloudflare.WorkerExecutionContext,
        Cloudflare.WorkerExecutionContext.of({
          access: Effect.succeedNone.pipe(Effect.map(Option.getOrUndefined)),
          cache: {
            purge: () => Effect.die(new Error("An error page must not purge")),
          },
          passThroughOnException: () => Effect.void,
          raw: {},
          waitUntil: () => Effect.void,
        })
      )
    );

    const body = yield* Effect.promise(response.text.bind(response));

    return { body, calls, response };
  });

const withAlchemyRuntime = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.acquireUseRelease(
    Effect.sync(() => {
      const previous = globalThis.__ALCHEMY_RUNTIME__;
      globalThis.__ALCHEMY_RUNTIME__ = true;

      return previous;
    }),
    () =>
      Effect.addFinalizer(() => Effect.promise(disposeFixtureAssets)).pipe(
        Effect.andThen(effect)
      ),
    (previous) =>
      Effect.sync(() => {
        globalThis.__ALCHEMY_RUNTIME__ = previous;
      })
  );

it.effect(
  "the Website renders HTML error pages over the WEBSITE binding with the reader policy",
  () =>
    withAlchemyRuntime(
      Effect.gen(function* websiteRenders() {
        for (const path of ["/nope-xyz", "/no-verify", "/lore/nope-xyz"]) {
          const { body, calls, response } = yield* requestThroughWorker(
            "renders",
            path,
            "text/html"
          );

          const code = path === "/no-verify" ? 403 : 404;

          expect(response.status, path).toBe(code);
          expect(body, path).toContain(websiteMarker);
          expect(body, path).toContain(
            `<span class="error-code">${code}</span>`
          );
          expect(calls, path).toContain(`POST ${readerErrorPath}`);
          expect(response.headers.get("content-security-policy"), path).toBe(
            readerContentSecurityPolicy
          );
          expect(
            response.headers.get("strict-transport-security"),
            path
          ).not.toBeNull();
        }
      })
    )
);

it.effect(
  "an error page never errors: every Website failure falls back to the Mischief page",
  () =>
    withAlchemyRuntime(
      Effect.gen(function* websiteFails() {
        for (const mode of ["throws", "wrong status", "plain text"] as const) {
          for (const path of ["/nope-xyz", "/no-verify", "/lore/nope-xyz"]) {
            const { body, calls, response } = yield* requestThroughWorker(
              mode,
              path,
              "text/html"
            );

            const code = path === "/no-verify" ? 403 : 404;

            expect(response.status, `${mode} ${path}`).toBe(code);
            expect(body, `${mode} ${path}`).not.toContain(websiteMarker);
            expect(body, `${mode} ${path}`).toContain(
              `<span class="error-code">${code}</span>`
            );
            expect(body, `${mode} ${path}`).toContain("<footer>");
            expect(calls, `${mode} ${path}`).toContain(
              `POST ${readerErrorPath}`
            );
            expect(
              response.headers.get("content-security-policy"),
              `${mode} ${path}`
            ).not.toBe(readerContentSecurityPolicy);
          }
        }
      })
    )
);

it.effect(
  "Markdown error pages stay in Mischief without asking the Website",
  () =>
    withAlchemyRuntime(
      Effect.gen(function* markdownErrors() {
        const { body, calls, response } = yield* requestThroughWorker(
          "renders",
          "/nope-xyz",
          "text/markdown"
        );

        expect(response.status).toBe(404);
        expect(body.startsWith("# 404 Not found")).toBe(true);
        expect(calls).toEqual([]);
      })
    )
);
