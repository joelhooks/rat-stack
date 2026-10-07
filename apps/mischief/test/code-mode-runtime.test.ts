import { expect } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Clock, Effect, FileSystem } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import { backlinks } from "../src/capabilities/index.js";
import { nodeContentLayer } from "../src/node-content.js";
import CodeModeWorker from "./fixtures/code-mode-worker.js";

const measureRequest = Effect.fn("measureContentRequest")(
  function* measureRequest(
    url: string,
    name: string,
    input:
      | { readonly query: string; readonly limit: number }
      | { readonly id: string },
    temperature: "cold" | "warm"
  ) {
    const started = yield* Clock.currentTimeMillis;

    const response = yield* HttpClientRequest.post(
      new URL(`/api/${name}`, url)
    ).pipe(
      HttpClientRequest.bodyJson(input),
      Effect.flatMap(HttpClient.execute)
    );

    const body = yield* response.json;
    const ended = yield* Clock.currentTimeMillis;

    expect(response.status).toBe(200);

    return { body, capability: name, elapsedMs: ended - started, temperature };
  }
);

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `code_mode_runtime_${process.pid}`,
});

test.provider(
  "content code mode discovers callable names but cannot submit an application",
  (stack) =>
    Effect.gen(function* discoversContentTools() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's ScratchStack erases provider errors; orDie closes this local runtime boundary.
      const worker = yield* stack.deploy(CodeModeWorker).pipe(Effect.orDie);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      const readinessStarted = yield* Clock.currentTimeMillis;

      const readiness = yield* HttpClientRequest.post(
        new URL("/api/assetProbe", url)
      ).pipe(
        HttpClientRequest.bodyJson({}),
        Effect.flatMap(HttpClient.execute)
      );

      expect(readiness.status).toBe(200);
      expect(yield* readiness.json).toBeGreaterThan(0);
      const readinessEnded = yield* Clock.currentTimeMillis;

      const samples = yield* Effect.all(
        [
          measureRequest(
            url,
            "search",
            { limit: 1, query: "cartridges" },
            "cold"
          ),
          measureRequest(
            url,
            "search",
            { limit: 1, query: "cartridges" },
            "warm"
          ),
          measureRequest(
            url,
            "read",
            { id: "ratstack://lore/cartridges" },
            "cold"
          ),
          measureRequest(
            url,
            "read",
            { id: "ratstack://lore/cartridges" },
            "warm"
          ),
        ],
        { concurrency: 1 }
      );

      const [coldSearch, warmSearch, coldRead, warmRead] = samples;
      expect(coldSearch.body).toEqual(warmSearch.body);
      expect(coldRead.body).toEqual(warmRead.body);

      const fs = yield* FileSystem.FileSystem;
      yield* fs.makeDirectory("dist/startup", { recursive: true });
      yield* fs.writeFileString(
        "dist/startup/content-request-latency.json",
        JSON.stringify({
          readinessMs: readinessEnded - readinessStarted,
          samples: samples.map(({ capability, elapsedMs, temperature }) => ({
            capability,
            elapsedMs,
            temperature,
          })),
        })
      );

      const expectedLinks = yield* backlinks
        .handler({ slug: "cartridges" })
        .pipe(Effect.provide(nodeContentLayer));

      const response = yield* HttpClientRequest.post(
        new URL("/api/execute", url)
      ).pipe(
        HttpClientRequest.bodyJson({
          code: [
            "const names = Object.keys(tools);",
            "const name = names.find((value) => value === 'search');",
            "const found = await tools[name]({ query: 'cartridges', limit: 1 });",
            "const page = await tools.read({ id: found.matches[0].id });",
            "const links = await tools.backlinks({ slug: 'cartridges' });",
            "let refused;",
            "try { await tools.joinInterest({}); } catch (error) { refused = error._tag; }",
            "return { names, refused, title: page.title, links };",
          ].join("\n"),
        }),
        Effect.flatMap(HttpClient.execute)
      );

      const body = yield* response.json;

      expect({ body, status: response.status }).toMatchObject({ status: 200 });
      expect(body).toEqual({
        logs: [],
        result: {
          links: expectedLinks,
          names: [
            "listPrompts",
            "getPrompt",
            "search",
            "read",
            "backlinks",
            "neighbors",
            "mentions",
            "path",
          ],
          refused: "UnknownCapability",
          title: "Cartridges",
        },
      });
    }),
  { timeout: 120_000 }
);
