import type { JoinRetentionDiagnosticSchema } from "@rat-stack/core/join-interest";
import {
  JOIN_RETENTION_DEFAULT_LIMIT,
  JOIN_RETENTION_MAX_LIMIT,
  JoinContactStore,
  JoinRetentionBackfill,
  JoinRetentionBackfillUnavailable,
  SWEEP_CONCURRENCY,
} from "@rat-stack/core/join-interest";
import { Effect, Layer, Logger } from "effect";

import { retentionDiagnostic } from "./join-retention-diagnostic.js";

export const joinRetentionBackfillLayer = (
  ids: () => Effect.Effect<readonly string[]>
) =>
  Layer.effect(
    JoinRetentionBackfill,
    Effect.gen(function* makeBackfill() {
      const contacts = yield* JoinContactStore;
      const loggers = yield* Logger.CurrentLoggers;

      const atStep = <A, E, R>(
        step: typeof JoinRetentionDiagnosticSchema.Type.step,
        submissionId: string | null,
        task: Effect.Effect<A, E, R>
      ) =>
        task.pipe(
          Effect.catchCause((cause) =>
            Effect.gen(function* diagnose() {
              const diagnostic = retentionDiagnostic(step, submissionId, cause);
              yield* Effect.logError(
                "Retention backfill failed",
                diagnostic
              ).pipe(Effect.provideService(Logger.CurrentLoggers, loggers));

              return yield* new JoinRetentionBackfillUnavailable({
                reason:
                  "Retention backfill page unavailable. Fix: inspect the safe operator diagnostic, restore storage availability, then rerun a preview.",
                diagnostic,
              });
            })
          )
        );

      return {
        run: Effect.fn("JoinRetentionBackfill.run")(function* run(
          dryRun: boolean,
          after?: string,
          limit = JOIN_RETENTION_DEFAULT_LIMIT
        ) {
          const remaining = [
            ...new Set(yield* atStep("index", null, Effect.suspend(ids))),
          ]
            .toSorted()
            .filter((id) => after === undefined || id > after);

          const page = remaining.slice(
            0,
            Math.min(JOIN_RETENTION_MAX_LIMIT, Math.max(1, limit))
          );

          const nextCursor =
            remaining.length > page.length ? (page.at(-1) ?? null) : null;

          const outcomes = yield* Effect.forEach(
            page,
            (id) =>
              Effect.gen(function* migrateAndCountUnknownHandoff() {
                const group = yield* atStep(
                  "migrate",
                  id,
                  Effect.suspend(() => contacts.migrateRetention(id, dryRun))
                );

                const handoff = yield* atStep(
                  "handoff",
                  id,
                  Effect.suspend(() => contacts.readHandoff(id))
                );

                const legacy =
                  handoff === undefined &&
                  ["pending", "finished", "erase"].includes(group);

                return {
                  group,
                  unknownHandoffTime:
                    (handoff?.handedToDrovrAt ?? null) === null &&
                    (handoff?.handedToDrovr === true ||
                      legacy ||
                      group === "unreadable" ||
                      (group === "gone" && handoff === undefined)),
                };
              }),
            { concurrency: SWEEP_CONCURRENCY }
          );

          const counts = {
            current: 0,
            erase: 0,
            finished: 0,
            gone: 0,
            legacyHandoffTimeUnknown: 0,
            nextCursor,
            pending: 0,
            unreadable: 0,
          };

          for (const outcome of outcomes) {
            counts[outcome.group] += 1;

            if (outcome.unknownHandoffTime) {
              counts.legacyHandoffTimeUnknown += 1;
            }
          }

          return counts;
        }),
      };
    })
  );
