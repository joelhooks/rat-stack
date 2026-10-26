import { gateOutcome } from "@rat-stack/check-harness";
import type { Verdict } from "@rat-stack/check-harness";
import { Effect, Option, Schema } from "effect";

import { DeployStepError } from "./contracts.js";
import { runPoll } from "./poll-machine.js";

export const workerVersionRetryDefaults = {
  deadlineMs: 120_000,
  initialDelayMs: 1000,
  maximumDelayMs: 10_000,
};

export const WorkerAttributes = Schema.Struct({
  versionId: Schema.optional(Schema.String),
  workerName: Schema.NonEmptyString,
});

export const settledWorkerVersion = Effect.fn("settledWorkerVersion")(
  function* settledWorkerVersion<E, R>(
    read: Effect.Effect<Option.Option<string>, E, R>,
    worker: string,
    previous: string | undefined,
    changed: boolean,
    options: typeof workerVersionRetryDefaults
  ) {
    const { attempts, elapsedMs } = yield* runPoll(
      (remainingMs) =>
        read.pipe(
          Effect.timeout(Math.max(1, remainingMs)),
          Effect.orElseSucceed(() => Option.none<string>()),
          Effect.map((observed) => {
            const version = Option.getOrUndefined(observed);

            return {
              observation: version,
              settled:
                version !== undefined && (!changed || version !== previous),
            };
          })
        ),
      options
    );

    const last = attempts.at(-1);

    if (last === undefined) {
      return yield* Effect.die("worker-version-poll-without-attempt");
    }

    const version = last.observation;
    const passed = version !== undefined && (!changed || version !== previous);

    return {
      check: `worker-version-readback:${worker}`,
      control: 1,
      counts: {
        attempts: attempts.length,
        deadlineMs: options.deadlineMs,
        durationMs: elapsedMs,
        failedAttempts: passed ? attempts.length - 1 : attempts.length,
      },
      observedAt: last.observedAt,
      provenance: attempts.map((attempt, index) => ({
        fetchedAt: attempt.observedAt,
        id: `worker-attempt:${index + 1}`,
        source: worker,
        status: `version=${attempt.observation ?? "unavailable"}`,
      })),
      reason: passed
        ? "worker-live-version-confirmed"
        : "worker-live-version-deadline-exhausted",
      resourceVersion: version ?? "unavailable",
      ...(passed
        ? { exitCode: 0, outcome: "passed", status: "green" }
        : { exitCode: 2, outcome: "failed", status: "red" }),
    } satisfies Verdict;
  }
);

export const readWorkerVersionSet = Effect.fn("readWorkerVersionSet")(
  function* readWorkerVersionSet<E, R>(
    workers: readonly {
      readonly action: string;
      readonly attributes: unknown;
    }[],
    previous: Readonly<Record<string, string>>,
    read: (worker: string) => Effect.Effect<Option.Option<string>, E, R>,
    options: typeof workerVersionRetryDefaults
  ) {
    const versions: Record<string, string> = {};
    const checks: Verdict[] = [];
    const names = new Set<string>();

    for (const worker of workers) {
      const attributes = yield* Schema.decodeUnknownEffect(WorkerAttributes)(
        worker.attributes
      ).pipe(
        Effect.mapError(
          () =>
            new DeployStepError({
              keys: [],
              reason: "worker-readback-name-invalid",
              step: "apply",
            })
        )
      );

      if (names.has(attributes.workerName)) {
        return yield* new DeployStepError({
          keys: [],
          reason: "worker-readback-name-duplicate",
          step: "apply",
        });
      }

      names.add(attributes.workerName);

      const check = yield* settledWorkerVersion(
        read(attributes.workerName),
        attributes.workerName,
        previous[attributes.workerName],
        worker.action !== "noop",
        options
      );

      checks.push(check);

      if (
        gateOutcome(check) === "pass" &&
        check.resourceVersion !== undefined
      ) {
        versions[attributes.workerName] = check.resourceVersion;
      }
    }

    return { checks, versions };
  }
);
