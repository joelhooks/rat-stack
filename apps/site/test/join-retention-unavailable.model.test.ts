import { expect, it } from "@effect/vitest";
import {
  JoinContactStore,
  JoinRetentionBackfill,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Exit, Layer, Logger, Option, Schema } from "effect";

import { joinRetentionBackfillLayer } from "../src/interest/join-retention-backfill.js";

it.effect.prop(
  "index, migration and handoff defects fail the page with the typed operator error without retaining private causes",
  {
    stage: Schema.Literals(["index", "migrate", "handoff"]),
    dryRun: Schema.Boolean,
  },
  ({ stage, dryRun }) =>
    Effect.gen(function* failureBoundary() {
      const secret = "synthetic-private-storage-cause";

      const contacts = yield* JoinContactStore.pipe(
        Effect.provide(JoinContactStore.testLayer)
      );

      const unavailable = Effect.die(new TypeError(secret));
      const logs: unknown[] = [];

      const logger = Logger.formatStructured.pipe(
        Logger.map((record) => logs.push(record))
      );

      const broken: JoinContactStore["Service"] = {
        ...contacts,
        migrateRetention: () =>
          stage === "migrate" ? unavailable : Effect.succeed("pending"),
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
        Effect.exit,
        Effect.provide(Logger.layer([logger]))
      );

      expect(Exit.isFailure(result)).toBe(true);

      if (Exit.isFailure(result)) {
        const failure = Cause.findErrorOption(result.cause);
        expect(Option.isSome(failure)).toBe(true);

        if (Option.isSome(failure)) {
          const diagnostic = {
            step: stage,
            submissionId: stage === "index" ? null : "synthetic-legacy",
            kind: "Defect",
            name: "TypeError",
          };

          expect(failure.value.diagnostic).toEqual(diagnostic);
          expect(logs).toMatchObject([
            { message: ["Retention backfill failed", diagnostic] },
          ]);
        }

        expect(JSON.stringify(result)).not.toContain(secret);
        expect(JSON.stringify(logs)).not.toContain(secret);
        expect(Cause.hasFails(result.cause)).toBe(true);
        expect(Cause.hasDies(result.cause)).toBe(false);
      }
    })
);
