import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { FeedbackRequest } from "@rat-stack/core/learn";
import { Effect, Schema } from "effect";
import { HttpClient, HttpClientRequest } from "effect/http";

import ColdAuthWorker from "./fixtures/cold-auth-worker.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `cold_auth_${process.pid}`,
});

test.provider(
  "the first request loads D1 auth and persists a feedback device for a later request",
  (stack) =>
    Effect.gen(function* firstAuthRequest() {
      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Alchemy's ScratchStack erases provider errors; orDie closes this local runtime boundary.
      const worker = yield* stack.deploy(ColdAuthWorker).pipe(Effect.orDie);
      const url = yield* Effect.fromNullishOr(worker.url).pipe(Effect.orDie);

      const requested = yield* HttpClientRequest.post(
        new URL("/private/feedbackAuthorRequest", url)
      ).pipe(
        HttpClientRequest.bodyJson({}),
        Effect.flatMap(HttpClient.execute)
      );

      expect(requested.status).toBe(200);

      const device = yield* requested.json.pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(FeedbackRequest))
      );

      expect(device.deviceCode).not.toBe("");
      expect(device.userCode).not.toBe("");
      expect(device.expiresIn).toBeGreaterThan(0);

      const inspected = yield* HttpClientRequest.post(
        new URL("/private/feedbackAuthorDevice", url)
      ).pipe(
        HttpClientRequest.bodyJson({ code: device.deviceCode }),
        Effect.flatMap(HttpClient.execute)
      );

      expect(inspected.status).toBe(200);
      expect(yield* inspected.json).toMatchObject({ state: "pending" });

      const anonymous = yield* HttpClientRequest.get(
        new URL("/auth/get-session", url)
      ).pipe(HttpClient.execute);

      expect(anonymous.status).toBe(200);
      expect(yield* anonymous.json).toBeNull();
    })
);
