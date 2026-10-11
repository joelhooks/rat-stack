import { expect } from "@effect/vitest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import ColdContentWorker from "./fixtures/cold-content-worker.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `cold_content_${process.pid}`,
});

test.provider(
  "concurrent first content requests finish in one fresh workerd isolate",
  (stack) =>
    Effect.gen(function* concurrentFirstRequests() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's ScratchStack erases provider errors; orDie closes this local runtime boundary.
      const worker = yield* stack.deploy(ColdContentWorker).pipe(Effect.orDie);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      const paths = [
        "/",
        "/VISION.md",
        "/sitemap.xml",
        "/log",
        "/lore/effect-basics",
        "/resources/peers",
      ];

      const responses = yield* Effect.all(
        paths.flatMap((path) =>
          Array.from({ length: 4 }, (_, index) =>
            HttpClientRequest.get(new URL(path, url)).pipe(
              HttpClientRequest.setHeader(
                "accept",
                index % 2 === 0 ? "text/html" : "text/markdown"
              ),
              HttpClient.execute,
              Effect.flatMap((response) =>
                response.text.pipe(
                  Effect.map((body) => ({
                    body,
                    path,
                    status: response.status,
                  }))
                )
              )
            )
          )
        ),
        { concurrency: "unbounded" }
      );

      yield* Effect.logInfo({
        completedRequests: responses.length,
        unsuccessfulRequests: responses.filter(
          (response) => response.status !== 200
        ).length,
      });

      for (const response of responses) {
        expect(response.status, response.path).toBe(200);
        expect(response.body, response.path).not.toBe("");
      }
    })
);
