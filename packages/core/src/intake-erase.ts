import { CallWatch } from "@rat-stack/capability/call-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer, Logger, Schedule, Schema } from "effect";

import { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";
import { IntakeEvents } from "./intake-events.js";
import { JoinContactStore, withPending } from "./join-contact-store.js";

export const IntakeEraseCountsSchema = Schema.Struct({
  alreadyGone: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  erased: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  pending: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type IntakeEraseCounts = typeof IntakeEraseCountsSchema.Type;

export const RETRY_ERASE_TOMBSTONE = Schedule.max([
  Schedule.exponential("200 millis"),
  Schedule.recurs(3),
]).pipe(Schedule.jittered);

export const settleErase = Effect.fnUntraced(function* settleErase(
  contacts: JoinContactStore["Service"],
  events: IntakeEvents["Service"],
  submissionId: string
) {
  const contact = yield* contacts.read(submissionId);

  if (contact === undefined) {
    return "alreadyGone" as const;
  }

  if (contact.pending !== "erase") {
    yield* contacts.save(withPending(contact, "erase"));
  }

  return yield* events.erase(contact.contactRef).pipe(
    Effect.retry(RETRY_ERASE_TOMBSTONE),
    Effect.andThen(contacts.erase(submissionId)),
    Effect.as("erased" as const),
    Effect.catchTag("IntakeEventsUnavailable", () =>
      Effect.succeed("pending" as const)
    )
  );
});

const eraseContacts = Effect.fnUntraced(function* eraseContacts(
  contacts: JoinContactStore["Service"],
  events: IntakeEvents["Service"],
  submissionIds: readonly string[]
) {
  const outcomes = yield* Effect.forEach([...new Set(submissionIds)], (id) =>
    settleErase(contacts, events, id).pipe(
      Effect.catchCause(() => Effect.succeed("failed" as const))
    )
  );

  const count = (outcome: (typeof outcomes)[number]) =>
    outcomes.filter((settled) => settled === outcome).length;

  return {
    alreadyGone: count("alreadyGone"),
    erased: count("erased"),
    failed: count("failed"),
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
