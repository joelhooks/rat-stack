import { expect, it } from "@effect/vitest";
import {
  JoinContactStore,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Schema } from "effect";

import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect.prop(
  "index, migration and handoff defects fail the page with the typed operator error without retaining private causes",
  {
    stage: Schema.Literals(["index", "migration", "handoff"]),
    dryRun: Schema.Boolean,
  },
  ({ stage, dryRun }) =>
    Effect.gen(function* failureBoundary() {
      const secret = "synthetic-private-storage-cause";

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(JoinContactStore.testLayer)
      );

      const unavailable = Effect.die(secret);

      const broken: JoinContactStore["Service"] = {
        ...contacts,
        migrateRetention: () =>
          stage === "migration" ? unavailable : Effect.succeed("pending"),
        readHandoff: () =>
          stage === "handoff" ? unavailable : Effect.undefined,
      };

      const result = yield* JoinRetentionBackfill.use((service) =>
        service.run(dryRun)
      ).pipe(
        Effect.provide(
          joinRetentionBackfillLayer(() =>
            stage === "index"
              ? unavailable
              : Effect.succeed(["synthetic-legacy"])
          ).pipe(Layer.provide(Layer.succeed(JoinContactStore, broken)))
        ),
        Effect.exit
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        expect(Cause.pretty(result.cause)).toContain(
          "JoinRetentionBackfillUnavailable"
        );
        expect(Cause.pretty(result.cause)).not.toContain(secret);
        expect(Cause.hasFails(result.cause)).toBe(true);
        expect(Cause.hasDies(result.cause)).toBe(false);
      }
    })
);
