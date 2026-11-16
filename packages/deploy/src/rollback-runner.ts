import { gateOutcome } from "@rat-stack/check-harness";
import { Clock, Context, Effect, Layer, Option, Result } from "effect";

import { measuredCheck, postDeployChecks } from "./checks.js";
import { ReceiptStore } from "./receipt-store.js";
import type {
  RollbackInput,
  RollbackReceipt,
  RollbackSource,
} from "./rollback-contracts.js";
import { RollbackFailed } from "./rollback-failed.js";
import type { RollbackRefused } from "./rollback-refused.js";
import { WorkerDeployments } from "./worker-deployments.js";

export class RollbackRunner extends Context.Service<
  RollbackRunner,
  {
    readonly load: (
      input: RollbackInput
    ) => Effect.Effect<RollbackSource, RollbackRefused>;
    readonly restore: (
      source: RollbackSource
    ) => Effect.Effect<RollbackReceipt, RollbackFailed>;
    readonly check: (
      receipt: RollbackReceipt
    ) => Effect.Effect<RollbackReceipt, RollbackFailed>;
    readonly record: (
      receipt: RollbackReceipt
    ) => Effect.Effect<RollbackReceipt, RollbackFailed>;
  }
>()("@rat-stack/deploy/RollbackRunner") {
  static layer = (baseUrl: string) =>
    Layer.effect(
      RollbackRunner,
      Effect.gen(function* makeRollbackRunner() {
        const receipts = yield* ReceiptStore;
        const deployments = yield* WorkerDeployments;

        const load = (input: RollbackInput) =>
          receipts
            .readApply(input.profile, input.receipt)
            .pipe(
              Effect.map((source) => ({ ...source, profile: input.profile }))
            );

        const record = (receipt: RollbackReceipt) =>
          receipts.saveRollback(receipt).pipe(
            Effect.mapError(
              () =>
                new RollbackFailed({
                  receipt: { ...receipt, outcome: "unknown" },
                })
            ),
            Effect.as(receipt)
          );

        const restore = Effect.fn("RollbackRunner.restore")(function* restore(
          source: RollbackSource
        ) {
          let receipt: RollbackReceipt = {
            checks: [],
            completed: [],
            observedAt: yield* Clock.currentTimeMillis,
            operation: "rollback",
            outcome: "restoring",
            profile: source.profile,
            source,
            targets: source.receipt.previousVersions ?? {},
            versions: {},
          };

          yield* record(receipt);

          const session = yield* deployments
            .forProfile(source.profile)
            .pipe(Effect.mapError(() => new RollbackFailed({ receipt })));

          const completed: string[] = [];
          const confirmed: Record<string, string> = {};

          for (const [worker, version] of Object.entries(receipt.targets)) {
            const restored = yield* Effect.gen(function* restoreWorker() {
              const current = yield* session.current(worker);

              if (Option.isNone(current) || current.value !== version) {
                yield* session.restore(worker, version);
              }

              const live = yield* session.current(worker);

              return Option.isSome(live) && live.value === version;
            }).pipe(Effect.result);

            if (Result.isFailure(restored) || !restored.success) {
              receipt = Object.assign(receipt, { outcome: "failed" });
              yield* record(receipt);

              return yield* new RollbackFailed({ receipt });
            }

            completed.push(worker);
            confirmed[worker] = version;
            receipt = Object.assign(receipt, {
              completed: [...completed],
              versions: { ...confirmed },
            });
            yield* record(receipt);
          }

          return {
            ...receipt,
            observedAt: yield* Clock.currentTimeMillis,
            outcome: "restored",
          } satisfies RollbackReceipt;
        });

        const check = Effect.fn("RollbackRunner.check")(function* check(
          receipt: RollbackReceipt
        ) {
          const session = yield* deployments
            .forProfile(receipt.profile)
            .pipe(Effect.mapError(() => new RollbackFailed({ receipt })));

          const generation = receipt.source.receipt.previousContentGeneration;

          const checks =
            generation === undefined
              ? [
                  yield* measuredCheck(
                    "rollback-content-generation-unavailable",
                    Effect.succeed(false)
                  ),
                ]
              : yield* postDeployChecks(
                  baseUrl,
                  generation,
                  receipt.observedAt
                ).pipe(Effect.mapError(() => new RollbackFailed({ receipt })));

          for (const [worker, expected] of Object.entries(receipt.targets)) {
            checks.push(
              yield* measuredCheck(
                `worker-version:${worker}`,
                session
                  .current(worker)
                  .pipe(
                    Effect.map(
                      (live) => Option.isSome(live) && live.value === expected
                    )
                  )
              )
            );
          }

          let outcome: RollbackReceipt["outcome"] = "unknown";

          if (checks.every((value) => gateOutcome(value) === "pass")) {
            outcome = "healthy";
          } else if (checks.some((value) => gateOutcome(value) === "fail")) {
            outcome = "failed";
          }

          return { ...receipt, checks, outcome } satisfies RollbackReceipt;
        });

        const services =
          yield* Effect.context<Effect.Services<ReturnType<typeof check>>>();

        return RollbackRunner.of({
          check: (receipt) =>
            check(receipt).pipe(Effect.provideContext(services)),
          load,
          record,
          restore,
        });
      })
    );
}
