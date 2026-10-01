import { expect } from "@effect/vitest";
import { InterestTokens, REGISTER_ANSWER } from "@rat-stack/core/interest";
import * as Cloudflare from "alchemy/Cloudflare";
import * as Test from "alchemy/Test/Vitest";
import { Clock, Config, Effect, Redacted } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import InterestWorker from "./fixtures/interest-worker.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `interest_${process.pid}`,
});

const operatorRead = (url: string, token = "local-operator-token") =>
  HttpClient.get(new URL("/operator/interest", url), {
    headers: { authorization: `Bearer ${token}` },
  });

const postForm = (
  url: string,
  path: string,
  fields: Readonly<Record<string, string>>
) =>
  HttpClientRequest.post(new URL(path, url)).pipe(
    HttpClientRequest.bodyUrlParams(fields),
    HttpClient.execute
  );

test.provider(
  "a workerd Durable Object submission appears in the operator pending count",
  (stack) =>
    Effect.gen(function* checkDurableInterest() {
      expect(
        yield* Config.Boolean("ALCHEMY_TEST_DEV").pipe(Config.withDefault(true))
      ).toBe(true);

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's local ScratchStack erases provider errors; orDie ends them at this test boundary.
      const worker = yield* stack.deploy(InterestWorker).pipe(Effect.orDie);

      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      expect(new URL(url).hostname).toBe("localhost");
      expect((yield* operatorRead(url, "wrong-token")).status).toBe(401);

      const empty = yield* operatorRead(url);

      expect(empty.status).toBe(200);
      expect(yield* empty.json).toEqual({
        captured: 0,
        confirmed: [],
        pending: 0,
      });

      const submitted = yield* postForm(url, "/tokenmaxx/interest", {
        email: "reader@example.com",
      });

      expect(submitted.status).toBe(200);
      expect(yield* submitted.text).toContain(REGISTER_ANSWER);

      const pending = yield* operatorRead(url);

      expect(pending.status).toBe(200);
      expect(yield* pending.json).toEqual({
        captured: 0,
        confirmed: [],
        pending: 1,
      });

      const now = yield* Clock.currentTimeMillis;

      const token = yield* InterestTokens.use((tokens) =>
        tokens.sign({ address: "reader@example.com", expiresAt: now + 60_000 })
      ).pipe(
        Effect.provide(
          InterestTokens.layer(Redacted.make("local-token-secret"))
        )
      );

      const confirmed = yield* postForm(url, "/tokenmaxx/confirm", { token });

      expect(confirmed.status).toBe(200);

      const repeated = yield* HttpClientRequest.post(
        new URL("/api/registerInterest", url)
      ).pipe(
        HttpClientRequest.bodyJson({ email: "READER@example.com" }),
        Effect.flatMap(HttpClient.execute)
      );

      expect(repeated.status).toBe(200);
      expect(yield* repeated.json).toEqual({ message: REGISTER_ANSWER });

      const final = yield* operatorRead(url);

      expect(final.status).toBe(200);
      expect(yield* final.json).toMatchObject({
        confirmed: [{ address: "reader@example.com" }],
        pending: 0,
      });

      const jsonSubmitted = yield* HttpClientRequest.post(
        new URL("/api/registerInterest", url)
      ).pipe(
        HttpClientRequest.bodyJson({ email: "another@example.com" }),
        Effect.flatMap(HttpClient.execute)
      );

      expect(jsonSubmitted.status).toBe(200);
      expect(yield* jsonSubmitted.json).toEqual({ message: REGISTER_ANSWER });

      const jsonPending = yield* operatorRead(url);

      expect(jsonPending.status).toBe(200);
      expect(yield* jsonPending.json).toMatchObject({
        confirmed: [{ address: "reader@example.com" }],
        pending: 1,
      });
    }),
  { timeout: 120_000 }
);
