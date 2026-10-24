import { CallWatch } from "@rat-stack/capability/call-watch";
import { defineContract } from "@rat-stack/capability/contract";
import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer, Logger, Schema } from "effect";

import { IntakeApplicationsUnavailable } from "./intake-applications-unavailable.js";
import { SubscriberIntake } from "./interest-intake.js";
import { JoinContactSchema, JoinContactStore } from "./join-contact-store.js";
import {
  JoinDeliveryDeadline,
  runJoinDelivery,
} from "./join-delivery-machine.js";

const SubmissionId = Schema.String.check(
  Schema.isMinLength(1),
  Schema.isMaxLength(256)
);

const ContactState = Schema.Union([
  JoinContactSchema.fields.state,
  Schema.Literal("missing"),
]);

const RedeliveryInputSchema = Schema.Struct({
  dryRun: Schema.optionalKey(Schema.Boolean),
  includeRefused: Schema.optionalKey(Schema.Boolean),
  submissionIds: Schema.Array(SubmissionId).check(
    Schema.isMinLength(1),
    Schema.isMaxLength(100)
  ),
});

export type IntakeRedeliveryInput = typeof RedeliveryInputSchema.Type;

export const IntakeRedeliveryRowSchema = Schema.Struct({
  outcome: Schema.Literals([
    "accepted",
    "retry",
    "refused",
    "skipped",
    "would_send",
  ]),
  previousState: ContactState,
  state: ContactState,
  submissionId: SubmissionId,
});

export const IntakeRedeliverySchema = Schema.Struct({
  notAttempted: Schema.Array(SubmissionId),
  rows: Schema.Array(IntakeRedeliveryRowSchema),
});

export type IntakeRedelivery = typeof IntakeRedeliverySchema.Type;

export class IntakeRedeliver extends Context.Service<
  IntakeRedeliver,
  {
    readonly redeliver: (
      input: IntakeRedeliveryInput
    ) => Effect.Effect<IntakeRedelivery, IntakeApplicationsUnavailable>;
  }
>()("@rat-stack/core/IntakeRedeliver") {
  static readonly layer = Layer.effect(
    this,
    Effect.gen(function* makeIntakeRedelivery() {
      const contacts = yield* JoinContactStore;
      const intake = yield* SubscriberIntake;
      const deliveryDeadline = yield* JoinDeliveryDeadline;

      const redeliver = Effect.fnUntraced(
        function* redeliver({
          dryRun = false,
          includeRefused = false,
          submissionIds,
        }: IntakeRedeliveryInput) {
          const rows: IntakeRedelivery["rows"][number][] = [];

          for (const [index, submissionId] of submissionIds.entries()) {
            const contact = yield* contacts.read(submissionId);

            const previousState = contact?.state ?? "missing";

            const eligible =
              contact !== undefined &&
              !contact.hold &&
              (contact.state === "ready" ||
                (includeRefused && contact.state === "refused"));

            if (!eligible || dryRun) {
              rows.push({
                outcome: eligible ? "would_send" : "skipped",
                previousState,
                state: previousState,
                submissionId,
              });

              if (dryRun) {
                continue;
              }

              return { notAttempted: submissionIds.slice(index + 1), rows };
            }

            if (previousState === "refused") {
              yield* contacts.setState(submissionId, "ready");
            }

            const result = yield* runJoinDelivery({ submissionId }).pipe(
              Effect.provideService(SubscriberIntake, intake),
              Effect.provideService(JoinContactStore, contacts),
              Effect.provideService(JoinDeliveryDeadline, deliveryDeadline)
            );

            const stateFor = {
              accepted: "accepted",
              refused: "refused",
              retry: "ready",
            } as const;

            const state = stateFor[result.kind];
            yield* contacts.setState(submissionId, state);
            rows.push({
              outcome: result.kind,
              previousState,
              state,
              submissionId,
            });

            if (result.kind !== "accepted") {
              return { notAttempted: submissionIds.slice(index + 1), rows };
            }
          }

          return { notAttempted: [], rows };
        },
        Effect.catchCause(() =>
          Effect.fail(new IntakeApplicationsUnavailable({}))
        )
      );

      return { redeliver };
    })
  );
}

export const intakeRedeliverContract = defineContract("intakeRedeliver", {
  annotations: { readOnly: false },
  description:
    "Redeliver ready applications in order using their original submission ids. Stop at the first non-accepted outcome. Authenticated operator surface only.",
  failure: IntakeApplicationsUnavailable,
  input: RedeliveryInputSchema,
  output: IntakeRedeliverySchema,
});

const implementedIntakeRedeliver = implement(intakeRedeliverContract, (input) =>
  IntakeRedeliver.use((service) => service.redeliver(input))
);

export const intakeRedeliver = {
  ...implementedIntakeRedeliver,
  handler: (input: typeof intakeRedeliverContract.input.Type) =>
    implementedIntakeRedeliver.handler(input).pipe(
      Effect.withTracerEnabled(false),
      Effect.provide(Logger.layer([])),
      Effect.provideService(CallWatch, {
        around: (_contract, _input, run) => run,
      })
    ),
};
