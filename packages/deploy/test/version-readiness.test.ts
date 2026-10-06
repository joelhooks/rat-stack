import { expect, it } from "@effect/vitest";
import { gateOutcome } from "@rat-stack/check-harness";
import { DateTime, Effect, Schema } from "effect";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { contentVersionCheck, settledReadinessCheck } from "../src/checks.js";

const Signal = Schema.Literals(["pass", "site-error", "stale", "missing-time"]);

const appliedAt = DateTime.toEpochMillis(
  DateTime.makeUnsafe("2026-10-06T06:00:00.000Z")
);

interface GeneratedScanDocument {
  cacheHit: boolean;
  level: number;
  scannedAt?: string;
  siteError?: { httpStatus: number };
}

const observation = (signal: typeof Signal.Type) => {
  const document: GeneratedScanDocument = {
    cacheHit: signal === "stale",
    level: 5,
  };

  if (signal !== "missing-time") {
    document.scannedAt =
      signal === "stale"
        ? "2026-10-06T05:00:00.000Z"
        : "2026-10-06T06:01:00.000Z";
  }

  if (signal === "site-error") {
    document.siteError = { httpStatus: 500 };
  }

  return { document, status: 200 };
};

it.effect.prop(
  "one fresh passing scan settles; other histories get exactly one retry and keep the first failure",
  { first: Signal, second: Signal },
  ({ first, second }) =>
    Effect.gen(function* test() {
      const calls: string[] = [];

      const result = yield* settledReadinessCheck(
        Effect.sync(() => {
          const signal = calls.length === 0 ? first : second;
          calls.push(signal);

          return observation(signal);
        }),
        appliedAt
      );

      const passed = first === "pass" || second === "pass";
      expect(gateOutcome(result) === "pass").toBe(passed);
      expect(calls).toStrictEqual(first === "pass" ? [first] : [first, second]);
      expect(result.counts.attempts).toBe(calls.length);
      expect(
        result.provenance?.filter((row) => row.id.startsWith("attempt:"))
      ).toHaveLength(calls.length);
      expect(
        result.provenance?.some((row) => row.status.includes("scan="))
      ).toBe(true);

      if (first !== "pass") {
        expect(result.counts.failedAttempts).toBeGreaterThan(0);
      }
    }),
  { arbitrary: { runs: 100 } }
);

it.effect.prop(
  "content identity accepts weak and strong ETags, but never a missing, stale or failed response",
  {
    matches: Schema.Boolean,
    missing: Schema.Boolean,
    ok: Schema.Boolean,
    weak: Schema.Boolean,
  },
  ({ matches, missing, ok, weak }) =>
    Effect.gen(function* test() {
      const etag = `${weak ? "W/" : ""}"${matches ? "expected-generation" : "old-generation"}:default:%2Findex.md"`;

      const client = HttpClient.make((request) => {
        expect(request.headers["accept-encoding"]).toBe("identity");
        expect(new URL(request.url).searchParams.get("__rat_version")).toBe(
          "expected-generation"
        );

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("content", {
              headers: missing ? {} : { etag },
              status: ok ? 200 : 503,
            })
          )
        );
      });

      const result = yield* contentVersionCheck(
        "https://example.test",
        "/index.md",
        "expected-generation"
      ).pipe(Effect.provideService(HttpClient.HttpClient, client));

      expect(gateOutcome(result) === "pass").toBe(ok && matches && !missing);
      expect(result.provenance?.[0]?.status).toBe(
        `http=${ok ? 200 : 503};etag=${missing ? "missing" : etag}`
      );

      if (missing) {
        expect(result.control).toBe(0);
        expect(result.status).toBe("hold");
      }
    }),
  { arbitrary: { runs: 100 } }
);
