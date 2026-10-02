import { CallWatch } from "@rat-stack/capability/call-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Logger, Schema } from "effect";

import { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";
import { IntakeAnswersSchema } from "./intake-questions.js";

export { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";

export const IntakeApplicationSchema = Schema.Union([
  Schema.Struct({
    answers: IntakeAnswersSchema,
    email: Schema.String,
    hold: Schema.Boolean,
    score: Schema.Finite,
    share: Schema.Boolean,
    signals: Schema.Array(Schema.String),
    source: Schema.Literal("agent"),
    state: Schema.Literals(["held", "forwarded"]),
    submissionId: Schema.String,
    submittedAt: Schema.String,
  }),
  Schema.Struct({
    reason: Schema.Literal("erased"),
    state: Schema.Literal("erased"),
    submissionId: Schema.String,
  }),
  Schema.Struct({
    reason: Schema.Literal(
      "no answers: legacy browser signup or erased contact"
    ),
    state: Schema.Literal("no-answers"),
    submissionId: Schema.String,
  }),
]);

export const IntakeApplicationsSchema = Schema.Array(IntakeApplicationSchema);

export type IntakeApplication = typeof IntakeApplicationSchema.Type;

export class IntakeApplications extends Context.Service<
  IntakeApplications,
  {
    readonly list: (
      submissionId?: string
    ) => Effect.Effect<
      readonly IntakeApplication[],
      IntakeApplicationsUnavailable
    >;
  }
>()("@rat-stack/core/IntakeApplications") {}

export const intakeApplicationsContract = defineContract("intakeApplications", {
  annotations: { readOnly: true },
  description:
    "Read workshop applications on the authenticated operator surface only.",
  failure: IntakeApplicationsUnavailable,
  input: Schema.Struct({
    submissionId: Schema.optionalKey(
      Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(256))
    ),
  }),
  output: IntakeApplicationsSchema,
});

const implementedIntakeApplications = implement(
  intakeApplicationsContract,
  ({ submissionId }) =>
    IntakeApplications.pipe(
      Effect.flatMap((reader) => reader.list(submissionId))
    )
);

export const intakeApplications = {
  ...implementedIntakeApplications,
  handler: (input: typeof intakeApplicationsContract.input.Type) =>
    implementedIntakeApplications.handler(input).pipe(
      Effect.withTracerEnabled(false),
      Effect.provide(Logger.layer([])),
      Effect.provideService(CallWatch, {
        around: (_contract, _input, run) => run,
      })
    ),
};
