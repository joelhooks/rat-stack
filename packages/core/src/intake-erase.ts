import { CallWatch } from "@rat-stack/capability/call-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer, Logger, Schema } from "effect";

import { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";
import { JoinContactStore } from "./join-contact-store.js";

export const IntakeEraseCountsSchema = Schema.Struct({
  alreadyGone: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  erased: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  failed: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export type IntakeEraseCounts = typeof IntakeEraseCountsSchema.Type;

const eraseContact = Effect.fnUntraced(function* eraseContact(
  contacts: JoinContactStore["Service"],
  submissionId: string
) {
  const contact = yield* contacts.read(submissionId);

  if (contact === undefined) {
    return "alreadyGone" as const;
  }

  yield* contacts.erase(submissionId);

  return "erased" as const;
});

const eraseContacts = Effect.fnUntraced(function* eraseContacts(
  contacts: JoinContactStore["Service"],
  submissionIds: readonly string[]
) {
  const outcomes = yield* Effect.forEach([...new Set(submissionIds)], (id) =>
    eraseContact(contacts, id).pipe(
      Effect.catchCause(() => Effect.succeed("failed" as const))
    )
  );

  return {
    alreadyGone: outcomes.filter((outcome) => outcome === "alreadyGone").length,
    erased: outcomes.filter((outcome) => outcome === "erased").length,
    failed: outcomes.filter((outcome) => outcome === "failed").length,
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

      return {
        erase: (submissionIds: readonly string[]) =>
          eraseContacts(contacts, submissionIds),
      };
    })
  );
}

export const intakeEraseContract = defineContract("intakeErase", {
  annotations: { readOnly: false },
  description:
    "Erase local application contact and sealed answers on the authenticated operator surface only.",
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
