import { expect } from "@effect/vitest";
import { CAPTURE_ANSWER } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import InterestCaptureWorker from "./fixtures/interest-capture-worker.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `interest_capture_${process.pid}`,
});

const operator = { authorization: "Bearer local-operator-token" } as const;

const Capture = Schema.Struct({
  address: Schema.String,
  capturedAt: Schema.Finite,
  consentVersion: Schema.String,
  ipHash: Schema.String,
  submissionId: Schema.String,
  uaHash: Schema.String,
});

const Counts = Schema.Struct({
  deleted: Schema.Finite,
  notFound: Schema.Finite,
  requested: Schema.Finite,
});

const submit = (url: string, email: string) =>
  HttpClientRequest.post(new URL("/tokenmaxx/interest", url)).pipe(
    HttpClientRequest.bodyUrlParams({ email }),
    HttpClientRequest.setHeaders({
      "cf-connecting-ip": "203.0.113.9",
      "user-agent": "capture-test-agent",
    }),
    HttpClient.execute
  );

const remove = (url: string, body: Readonly<Record<string, string[]>>) =>
  HttpClientRequest.post(new URL("/operator/interest/delete", url)).pipe(
    HttpClientRequest.setHeaders(operator),
    HttpClientRequest.bodyJson(body),
    Effect.flatMap(HttpClient.execute),
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Counts))
  );

const exported = (url: string) =>
  HttpClient.get(new URL("/operator/interest/captures", url), {
    headers: operator,
  }).pipe(
    Effect.flatMap((response) => response.json),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.Array(Capture)))
  );

test.provider(
  "a workerd capture-mode submission is exported with evidence and deleted by either selector",
  (stack) =>
    Effect.gen(function* checkDurableCapture() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's local ScratchStack erases provider errors; orDie ends them at this test boundary.
      const worker = yield* stack
        .deploy(InterestCaptureWorker)
        .pipe(Effect.orDie);

      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      const first = yield* submit(url, "capture-one@example.com");
      const repeat = yield* submit(url, "CAPTURE-ONE@example.com");
      const second = yield* submit(url, "capture-two@example.com");

      for (const response of [first, repeat, second]) {
        expect(response.status).toBe(200);
        expect((yield* response.text).replaceAll("&#39;", "'")).toContain(
          CAPTURE_ANSWER
        );
      }

      const captures = yield* exported(url);

      expect(captures).toHaveLength(2);

      const one = captures.find(
        ({ address }) => address === "capture-one@example.com"
      );

      expect(one?.ipHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(one?.uaHash).toMatch(/^[0-9a-f]{64}$/u);
      expect(one?.ipHash).not.toBe(one?.uaHash);
      expect(JSON.stringify(captures)).not.toContain("203.0.113.9");
      expect(JSON.stringify(captures)).not.toContain("capture-test-agent");

      const summary = yield* HttpClient.get(
        new URL("/operator/interest", url),
        { headers: operator }
      ).pipe(Effect.flatMap((response) => response.json));

      expect(summary).toEqual({ captured: 2, confirmed: [], pending: 0 });

      expect(
        yield* remove(url, { submissionIds: [one?.submissionId ?? ""] })
      ).toEqual({ deleted: 1, notFound: 0, requested: 1 });

      expect(
        yield* remove(url, {
          addresses: ["capture-two@example.com", "nobody@example.com"],
        })
      ).toEqual({ deleted: 1, notFound: 1, requested: 2 });

      expect(yield* exported(url)).toEqual([]);
    }),
  { timeout: 120_000 }
);
