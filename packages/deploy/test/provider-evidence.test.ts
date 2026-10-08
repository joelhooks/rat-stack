import { expect, it } from "@effect/vitest";
import { Effect, Exit, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import { applyWithProviderEvidence } from "../src/provider-errors.js";

class BadRequest extends Schema.TaggedError<BadRequest>()("BadRequest", {
  message: Schema.String,
}) {}

it.effect.prop(
  "absent progress and API codes remain explicit while response bodies still reach the provider",
  {
    code: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 999_999, minimum: 1 }))
    ),
    hasCode: Arbitrary.schema(Schema.Boolean),
    hasResource: Arbitrary.schema(Schema.Boolean),
  },
  ({ code, hasCode, hasResource }) =>
    Effect.gen(function* missingMetadataSeam() {
      const message =
        "Upload rejected at index.js:12:34; source 192.0.2.1 and 2001:db8::1";

      const body = { errors: hasCode ? [{ code, message }] : [{ message }] };

      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            Response.json(body, { status: 400 })
          )
        )
      );

      const work = (observed: HttpClient.HttpClient) =>
        Effect.gen(function* typedProvider() {
          const response = yield* observed.execute(
            HttpClientRequest.put(
              "https://api.cloudflare.com/client/v4/accounts/test/workers/scripts/Mischief"
            )
          );

          expect(yield* response.json).toEqual(body);

          return yield* new BadRequest({ message });
        }).pipe(
          Effect.withSpan("apply.resource", {
            attributes: hasResource
              ? { "alchemy.resource.fqn": "Mischief" }
              : {},
          })
        );

      const captured = yield* applyWithProviderEvidence(
        work,
        client,
        () => Effect.void
      );

      expect(Exit.isFailure(captured.exit)).toBe(true);
      expect(captured.providerErrors).toEqual([
        {
          code: hasCode ? code : null,
          message: "Upload rejected at index.js:12:34; source [ip] and [ip]",
          resource: hasResource ? "Mischief" : null,
        },
      ]);
    })
);

it.effect(
  "malformed API diagnostics do not consume or replace the provider's failure",
  () =>
    Effect.gen(function* malformedResponseSeam() {
      const client = HttpClient.make((request) =>
        Effect.succeed(
          HttpClientResponse.fromWeb(
            request,
            new Response("not-json", { status: 400 })
          )
        )
      );

      const work = (observed: HttpClient.HttpClient) =>
        Effect.gen(function* providerFailure() {
          const response = yield* observed.execute(
            HttpClientRequest.put(
              "https://api.cloudflare.com/client/v4/accounts/test/workers/scripts/Mischief"
            )
          );

          expect(yield* response.text).toBe("not-json");

          return yield* new BadRequest({ message: "No usable API diagnostic" });
        });

      const captured = yield* applyWithProviderEvidence(
        work,
        client,
        () => Effect.void
      );

      expect(Exit.isFailure(captured.exit)).toBe(true);
      expect(captured.providerErrors).toEqual([
        { code: null, message: "No usable API diagnostic", resource: null },
      ]);
    })
);
