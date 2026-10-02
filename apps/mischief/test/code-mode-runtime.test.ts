import { expect } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import CodeModeWorker from "./fixtures/code-mode-worker.js";

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

      const response = yield* HttpClientRequest.post(
        new URL("/api/execute", url)
      ).pipe(
        HttpClientRequest.bodyJson({
          code: [
            "const names = Object.keys(tools);",
            "const name = names.find((value) => value === 'search');",
            "const found = await tools[name]({ query: 'cartridges', limit: 1 });",
            "let refused;",
            "try { await tools.joinInterest({}); } catch (error) { refused = error._tag; }",
            "return { names, refused, title: found.matches[0].title };",
          ].join("\n"),
        }),
        Effect.flatMap(HttpClient.execute)
      );

      const body = yield* response.json;

      expect({ body, status: response.status }).toMatchObject({ status: 200 });
      expect(body).toEqual({
        logs: [],
        result: {
          names: [
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
