import { expect, it } from "@effect/vitest";
import { Effect, Result } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";

import { readValidatedResponse } from "./fixtures/validated-http-response.js";

it.effect.each([
  { body: '{"version":4}', expected: "success", status: 200 },
  { body: '{"version":4}', expected: "status", status: 503 },
  { body: "{", expected: "body", status: 200 },
  { body: '{"version":"four"}', expected: "body", status: 200 },
])("checks status and decoded shape: $expected ($status, $body)", (scenario) =>
  Effect.gen(function* validateResponse() {
    const client = HttpClient.make((request) =>
      Effect.sync(() =>
        HttpClientResponse.fromWeb(
          request,
          new Response(scenario.body, {
            headers: { "content-type": "application/json" },
            status: scenario.status,
          })
        )
      )
    );

    const result = yield* readValidatedResponse().pipe(
      Effect.provideService(HttpClient.HttpClient, client),
      Effect.result
    );

    if (Result.isFailure(result)) {
      expect(result.failure._tag).toBe("ResponseFixtureError");
      expect(result.failure.phase).toBe(scenario.expected);
    } else {
      expect(scenario.expected).toBe("success");
      expect(result.success.version).toBe(4);
    }
  })
);
