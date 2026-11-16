import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  JoinRetentionBackfillUnavailable,
  runJoinRetentionWalk,
} from "@rat-stack/core/join-interest";
import { Config, Console, Effect, Layer, Logger, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import {
  remoteJoinRetentionBackfillLayer,
  retentionBackfillFailure,
} from "./retention-backfill-client.ts";

const Arguments = Schema.Struct({
  origin: Schema.String,
  flags: Schema.Array(Schema.Literals(["--apply", "--origin-override"])).check(
    Schema.isMaxLength(2)
  ),
});

const program = Effect.gen(function* retentionBackfill() {
  const [origin, ...flags] = process.argv.slice(2);
  const input = yield* Schema.decodeUnknownEffect(Arguments)({ origin, flags });
  const token = yield* Config.Redacted("INTEREST_OPERATOR_TOKEN");

  const counts = yield* runJoinRetentionWalk({
    apply: input.flags.includes("--apply"),
  }).pipe(
    Effect.provide(
      remoteJoinRetentionBackfillLayer(input.origin, token, {
        previewOriginOverride: input.flags.includes("--origin-override"),
      })
    )
  );

  yield* Console.log(JSON.stringify(counts));
}).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer)),
  Effect.withTracerEnabled(false),
  Effect.provide(Logger.layer([])),
  Effect.catchCause((cause) =>
    Effect.fail(
      retentionBackfillFailure(
        cause,
        new JoinRetentionBackfillUnavailable({
          reason:
            "Retention backfill failed; no complete totals were produced. Fix: set INTEREST_OPERATOR_TOKEN and run `pnpm --filter @rat-stack/site retention:backfill https://ratstack.sh [--apply]`; a different preview origin requires `--origin-override` and cannot apply. Verify endpoint availability and rerun a preview.",
        })
      )
    )
  )
);

NodeRuntime.runMain(program);
