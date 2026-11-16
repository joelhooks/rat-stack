import { expect, it } from "@effect/vitest";
import {
  runJoinRetentionWalk,
  JoinRetentionDiagnosticSchema,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Option, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { remoteJoinRetentionBackfillLayer } from "../scripts/retention-backfill-client.js";

it.effect.prop(
  "503 diagnostics cross the page machine only after literal-union validation and never echo the credential",
  {
    diagnostic: JoinRetentionDiagnosticSchema,
    corruption: Schema.Literals([
      "none",
      "step",
      "kind",
      "name",
      "submissionId",
      "credential",
    ]),
  },
  ({ diagnostic, corruption }) =>
    Effect.gen(function* diagnosticResponse() {
      const secret = "synthetic-token-that-must-not-be-printed";
      const expected = { ...diagnostic, submissionId: "synthetic-submission" };
      const base = { error: "applications_unavailable", ...expected };

      const invalidLiteral = "invalid@diagnostic.test";

      const invalid =
        corruption === "credential"
          ? { submissionId: secret }
          : { [corruption]: invalidLiteral };

      const body = corruption === "none" ? base : { ...base, ...invalid };

      const fetch: typeof globalThis.fetch = () =>
        Promise.resolve(Response.json(body, { status: 503 }));

      const result = yield* runJoinRetentionWalk({}).pipe(
        Effect.provide(
          remoteJoinRetentionBackfillLayer(
            "https://ratstack.sh",
            Redacted.make(secret)
          ).pipe(Layer.provide(FetchHttpClient.layer))
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const failure = Cause.findErrorOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);

        if (Option.isSome(failure)) {
          expect(failure.value.reason).toContain("HTTP 503");
          expect(failure.value.diagnostic).toEqual(
            corruption === "none" ? expected : undefined
          );

          if (corruption === "none") {
            expect(failure.value.reason).toContain(JSON.stringify(expected));
          } else {
            expect(failure.value.reason).toContain(
              "Unrecognized response body"
            );
          }
        }

        expect(JSON.stringify(result)).not.toContain(secret);
        expect(JSON.stringify(result)).not.toContain(invalidLiteral);
      }
    }).pipe(Effect.scoped)
);
