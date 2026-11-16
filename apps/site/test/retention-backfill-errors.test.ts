import { expect, it } from "@effect/vitest";
import { runJoinRetentionWalk } from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Redacted, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { remoteJoinRetentionBackfillLayer } from "../scripts/retention-backfill-client.js";

it.effect.prop(
  "HTTP failures preserve status and known route text through the page machine but never echo untrusted error bodies",
  {
    status: Schema.Literals([400, 401, 503]),
    known: Schema.Boolean,
  },
  ({ status, known }) =>
    Effect.gen(function* httpFailure() {
      const secret = "synthetic-private-credential-marker";

      const body = known
        ? "Applications unavailable.\n"
        : `untrusted ${secret}`;

      const fetch: typeof globalThis.fetch = () =>
        Promise.resolve(new Response(body, { status }));

      const failure = yield* runJoinRetentionWalk({}).pipe(
        Effect.provide(
          remoteJoinRetentionBackfillLayer(
            "https://ratstack.sh",
            Redacted.make(secret)
          ).pipe(Layer.provide(FetchHttpClient.layer))
        ),
        Effect.provideService(FetchHttpClient.Fetch, fetch),
        Effect.exit
      );

      expect(Exit.isFailure(failure)).toBe(true);

      if (Exit.isFailure(failure)) {
        const text = Cause.pretty(failure.cause);
        expect(text).toContain(`HTTP ${status}`);
        expect(text).toContain(
          known ? "Applications unavailable." : "Unrecognized response body"
        );
        expect(text).not.toContain(secret);
      }
    }).pipe(Effect.scoped)
);
