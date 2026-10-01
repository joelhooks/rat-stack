import { expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Option, Redacted } from "effect";
import { TestClock } from "effect/testing";
import { HttpClient, HttpClientResponse } from "effect/unstable/http";

import { drovrIntakeLayer, DrovrIntake } from "../src/interest-intake.js";
import type { IntakeRequest, IntakeResult } from "../src/interest-intake.js";

const intakeRequest: IntakeRequest = {
  challenge: "challenge-token",
  clientBucket: { ipHash: "a".repeat(64), uaHash: "b".repeat(64) },
  email: "reader@example.com",
  submissionId: "11111111-1111-4111-8111-111111111111",
};

const respondWith = (status: number, body: string | null) =>
  Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(request, new Response(body, { status }))
      )
    )
  );

const failing = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make(() => Effect.die(new Error("network down")))
);

const configured = {
  credential: "credential",
  url: "https://intake.test/submit",
} as const;

const submitVia = (
  client: Layer.Layer<HttpClient.HttpClient>,
  settings: {
    readonly credential?: string;
    readonly url?: string;
  } = configured
) =>
  DrovrIntake.use((intake) => intake.submit(intakeRequest)).pipe(
    Effect.provide(
      drovrIntakeLayer({
        credential: Option.fromNullishOr(settings.credential).pipe(
          Option.map(Redacted.make)
        ),
        url: Option.fromNullishOr(settings.url),
      }).pipe(Layer.provide(client))
    )
  );

const refused: IntakeResult = { kind: "refused" };

it.effect("accepts any 2xx, whatever its body", () =>
  Effect.gen(function* accepts() {
    for (const [status, body] of [
      [202, JSON.stringify({ accepted: true })],
      [202, "not json"],
      [200, JSON.stringify({ accepted: true })],
      [204, null],
    ] as const) {
      expect(yield* submitVia(respondWith(status, body))).toEqual({
        kind: "accepted",
      });
    }
  })
);

it.effect(
  "asks for an immediate retry when drovr is slower than the timeout",
  () =>
    Effect.gen(function* timesOut() {
      const hanging = Layer.succeed(
        HttpClient.HttpClient,
        HttpClient.make(() => Effect.never)
      );

      const fiber = yield* Effect.forkChild(submitVia(hanging));

      yield* TestClock.adjust("20 seconds");

      expect(yield* Fiber.join(fiber)).toEqual({
        afterSeconds: 0,
        kind: "retry",
      });
    })
);

it.effect("asks for a retry on a 503 that names its delay", () =>
  Effect.gen(function* retries() {
    expect(
      yield* submitVia(
        respondWith(503, JSON.stringify({ retryAfterSeconds: 2 }))
      )
    ).toEqual({ afterSeconds: 2, kind: "retry" });
    expect(yield* submitVia(respondWith(503, JSON.stringify({})))).toEqual(
      refused
    );
  })
);

it.effect("refuses every other status and a dead network", () =>
  Effect.gen(function* failsClosed() {
    for (const status of [400, 401, 403, 404, 409, 422, 429, 500, 502]) {
      expect(yield* submitVia(respondWith(status, JSON.stringify({})))).toEqual(
        refused
      );
    }

    expect(yield* submitVia(failing)).toEqual(refused);
  })
);

it.effect("refuses without calling out when a binding is missing", () =>
  Effect.gen(function* missingBindings() {
    const calls: number[] = [];

    const counting = Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make((request) => {
        calls.push(1);

        return Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response('{"accepted":true}', { status: 202 })
          )
        );
      })
    );

    expect(yield* submitVia(counting, { url: "https://intake.test/" })).toEqual(
      refused
    );
    expect(yield* submitVia(counting, { credential: "credential" })).toEqual(
      refused
    );
    expect(yield* submitVia(counting, {})).toEqual(refused);
    expect(calls).toEqual([]);
  })
);
