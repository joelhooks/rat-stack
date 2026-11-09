import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { Effect } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import InterestWorker from "./fixtures/interest-capture-worker.js";
import { deployScratch } from "./fixtures/scratch-deploy.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `interest_capture_runtime_${process.pid}`,
});

test.provider(
  "retired submissions never reach Durable Object storage",
  (stack) =>
    Effect.gen(function* retiredDurableSubmission() {
      const worker = yield* deployScratch(stack, InterestWorker);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      for (const path of ["/tokenmaxx/interest", "/api/registerInterest"]) {
        const response = yield* HttpClientRequest.post(new URL(path, url)).pipe(
          HttpClientRequest.bodyUrlParams({ email: "person@example.com" }),
          HttpClient.execute
        );

        expect(response.status).toBe(410);
        expect(yield* response.text).toContain("joinInterest");
      }

      const summary = yield* HttpClient.get(
        new URL("/operator/interest", url),
        { headers: { authorization: "Bearer local-operator-token" } }
      );

      expect(yield* summary.json).toEqual({
        captured: 0,
        confirmed: [],
        pending: 0,
      });

      const records = yield* HttpClient.get(
        new URL("/operator/interest/captures", url),
        { headers: { authorization: "Bearer local-operator-token" } }
      );

      expect(yield* records.json).toEqual([]);
    }),
  { timeout: 120_000 }
);
