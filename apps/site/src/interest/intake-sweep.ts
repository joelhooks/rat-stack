import type { IntakeEvents } from "@rat-stack/core/intake";
import type { SubscriberIntake } from "@rat-stack/core/interest";
import {
  IntakeSweep,
  JoinContactStore,
  JoinDeliveryDeadline,
  SWEEP_CONCURRENCY,
} from "@rat-stack/core/join-interest";
import { Context, Duration, Effect, Layer, Option } from "effect";

import type { AgentSignupOptions } from "./join-layer.js";

export const SWEEP_PENDING_INTAKE_CRON = "*/5 * * * *";

export const sweepPendingIntake = (
  ids: () => Effect.Effect<readonly string[]>,
  sweeper: IntakeSweep["Service"],
  contacts: JoinContactStore["Service"],
  markPending: (submissionId: string, pending: boolean) => Effect.Effect<void>
) =>
  Effect.gen(function* sweepPending() {
    const pending = yield* ids();

    if (pending.length === 0) {
      return;
    }

    const counts = yield* sweeper.sweep(pending);

    yield* Effect.forEach(
      pending,
      (submissionId) =>
        contacts
          .read(submissionId)
          .pipe(
            Effect.flatMap((contact) =>
              contact?.pending === undefined
                ? markPending(submissionId, false)
                : Effect.void
            )
          ),
      { concurrency: SWEEP_CONCURRENCY, discard: true }
    );

    yield* Effect.logInfo("intake sweep", counts);
  }).pipe(
    Effect.catchCause(() =>
      Effect.logWarning("intake sweep stopped; the next run retries it")
    )
  );

export const deliveryDeadlineLayer = (seconds: Option.Option<number>) =>
  Option.match(seconds, {
    onNone: () => Layer.empty,
    onSome: (value) =>
      Layer.succeed(JoinDeliveryDeadline, Duration.seconds(value)),
  });

export const scheduleIntakeSweep = Effect.fnUntraced(
  function* scheduleIntakeSweep(
    options: AgentSignupOptions | undefined,
    services:
      | Context.Context<JoinContactStore | IntakeEvents | SubscriberIntake>
      | undefined
  ) {
    if (options?.sweep === undefined || services === undefined) {
      return;
    }

    const sweeper = yield* IntakeSweep.pipe(
      Effect.provide(
        IntakeSweep.layer.pipe(Layer.provide(Layer.succeedContext(services)))
      )
    );

    yield* options.sweep.schedule(
      sweepPendingIntake(
        options.sweep.ids,
        sweeper,
        Context.get(services, JoinContactStore),
        options.markPending ?? (() => Effect.void)
      )
    );
  }
);
