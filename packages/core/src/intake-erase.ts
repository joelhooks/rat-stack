import { CallWatch } from "@rat-stack/capability/call-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Exit, Layer, Logger, Schedule, Schema } from "effect";

import { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";
import { IntakeEvents } from "./intake-events.js";
import { JoinContactStore } from "./join-contact-store.js";
import type { JoinErasure } from "./join-contact-store.js";

export const IntakeEraseCountsSchema = Schema.Struct({
  alreadyGone: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  erased: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  handedToDrovr: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)).annotate({
    description:
      "A delivery attempt may have left for drovr, so drovr may hold this contact; forward the erasure. This count includes unknown outcomes, final refusals and absent or unreadable history.",
  }),
  handedToDrovrSubmissionIds: Schema.Array(Schema.String).annotate({
    description:
      "Submission IDs whose erasure must also be forwarded to drovr. A durable dispatch-intent flag is conservative; it does not prove admission or email delivery.",
  }),
  handedToDrovrSubmissions: Schema.Array(
    Schema.Struct({
      submissionId: Schema.String,
      handedAt: Schema.NullOr(Schema.String),
    })
  ).annotate({
    description:
      "First dispatch-intent ISO time per submission. Null means the legacy dispatch time is unknown; never substitute the backfill time.",
  }),
  pending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type IntakeEraseCounts = typeof IntakeEraseCountsSchema.Type;

export const RETRY_ERASE_TOMBSTONE = Schedule.max([
  Schedule.exponential("200 millis"),
  Schedule.recurs(3),
]).pipe(Schedule.jittered);

const settleRequestedErase = Effect.fnUntraced(function* settleRequestedErase(
  contacts: JoinContactStore["Service"],
  events: IntakeEvents["Service"],
  submissionId: string,
  marker: JoinErasure | undefined
) {
  const erased = yield* contacts.erase(submissionId).pipe(Effect.exit);

  if (marker === undefined) {
    if (Exit.isFailure(erased)) {
      return yield* Effect.failCause(erased.cause);
    }

    return "alreadyGone" as const;
  }

  return yield* events.erase(marker.contactRef).pipe(
    Effect.retry(RETRY_ERASE_TOMBSTONE),
    Effect.andThen(
      Exit.isFailure(erased)
        ? Effect.succeed("pending" as const)
        : contacts
            .completeErasure(submissionId)
            .pipe(Effect.as("erased" as const))
    ),
    Effect.catchTag("IntakeEventsUnavailable", () =>
      Effect.succeed("pending" as const)
    )
  );
});

export const settleErase = Effect.fnUntraced(function* settleErase(
  contacts: JoinContactStore["Service"],
  events: IntakeEvents["Service"],
  submissionId: string
) {
  const marker = yield* contacts.requestErase(submissionId);

  return yield* settleRequestedErase(contacts, events, submissionId, marker);
});

const eraseContacts = Effect.fnUntraced(function* eraseContacts(
  contacts: JoinContactStore["Service"],
  events: IntakeEvents["Service"],
  submissionIds: readonly string[]
) {
  const outcomes = yield* Effect.forEach([...new Set(submissionIds)], (id) =>
    Effect.gen(function* eraseAndReportHandoff() {
      const marker = yield* contacts.requestErase(id);

      const outcome = yield* settleRequestedErase(
        contacts,
        events,
        id,
        marker
      ).pipe(Effect.catchCause(() => Effect.succeed("failed" as const)));

      return {
        handedToDrovr: marker === undefined || marker.handedToDrovr,
        handedAt: marker?.handedToDrovrAt ?? null,
        id,
        outcome,
      };
    }).pipe(
      Effect.catchCause(() =>
        contacts.readHandoff(id).pipe(
          Effect.catchCause(() => Effect.undefined),
          Effect.map((handoff) => ({
            handedToDrovr: true,
            handedAt: handoff?.handedToDrovrAt ?? null,
            id,
            outcome: "failed" as const,
          }))
        )
      )
    )
  );

  const count = (outcome: (typeof outcomes)[number]["outcome"]) =>
    outcomes.filter((settled) => settled.outcome === outcome).length;

  const handedToDrovrSubmissions = outcomes.flatMap((settled) =>
    settled.handedToDrovr
      ? [{ submissionId: settled.id, handedAt: settled.handedAt }]
      : []
  );

  const handedToDrovrSubmissionIds = handedToDrovrSubmissions.map(
    (submission) => submission.submissionId
  );

  return {
    alreadyGone: count("alreadyGone"),
    erased: count("erased"),
    failed: count("failed"),
    handedToDrovr: handedToDrovrSubmissionIds.length,
    handedToDrovrSubmissionIds,
    handedToDrovrSubmissions,
    pending: count("pending"),
  };
});

export class IntakeErasure extends Context.Service<
  IntakeErasure,
  {
    readonly erase: (
      submissionIds: readonly string[]
    ) => Effect.Effect<IntakeEraseCounts, IntakeApplicationsUnavailable>;
  }
>()("@rat-stack/core/IntakeErasure") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* makeIntakeErasure() {
      const contacts = yield* JoinContactStore;
      const events = yield* IntakeEvents;

      return {
        erase: (submissionIds: readonly string[]) =>
          eraseContacts(contacts, events, submissionIds),
      };
    })
  );
}

export const intakeEraseContract = defineContract("intakeErase", {
  annotations: { readOnly: false },
  description:
    "Erase local application contact and sealed answers on the authenticated operator surface only. A contact whose event tombstone cannot be written yet counts as pending; the intake sweep finishes it.",
  failure: IntakeApplicationsUnavailable,
  input: Schema.Struct({
    submissionIds: Schema.Array(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
    ).check(Schema.isMinLength(1), Schema.isMaxLength(100)),
  }),
  output: IntakeEraseCountsSchema,
});

const implementedIntakeErase = implement(
  intakeEraseContract,
  ({ submissionIds }) =>
    IntakeErasure.pipe(Effect.flatMap((eraser) => eraser.erase(submissionIds)))
);

export const intakeErase = {
  ...implementedIntakeErase,
  handler: (input: typeof intakeEraseContract.input.Type) =>
    implementedIntakeErase.handler(input).pipe(
      Effect.withTracerEnabled(false),
      Effect.provide(Logger.layer([])),
      Effect.provideService(CallWatch, {
        around: (_contract, _input, run) => run,
      })
    ),
};
