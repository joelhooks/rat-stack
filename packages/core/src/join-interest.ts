import { CallWatch } from "@rat-stack/capability/call-watch";
import type { Around } from "@rat-stack/capability/call-watch";
import { implement } from "@rat-stack/capability/implement";
import { Effect, Option } from "effect";

import {
  JOIN_ANSWER,
  JOIN_BUSY,
  JOIN_DELAYED,
  JOIN_NOT_OPEN,
  joinInterestContract,
} from "./join-interest-contract.js";
import type { JoinInput, JoinOutput } from "./join-interest-contract.js";
import { JoinInterest } from "./join-interest-port.js";
import { MaskedInterestReplay } from "./masked-interest-replay.js";

export { JoinIdentity } from "./join-identity.js";

export { JoinInterest } from "./join-interest-port.js";

export {
  IntakeApplications,
  IntakeApplicationsUnavailable,
  IntakeApplicationSchema,
  IntakeApplicationsSchema,
  intakeApplications,
  intakeApplicationsContract,
} from "./intake-applications.js";

export type { IntakeApplication } from "./intake-applications.js";

export {
  IntakeErasure,
  IntakeEraseCountsSchema,
  intakeErase,
  intakeEraseContract,
} from "./intake-erase.js";

export type { IntakeEraseCounts } from "./intake-erase.js";

export {
  IntakeRedeliver,
  IntakeRedeliverySchema,
  intakeRedeliver,
  intakeRedeliverContract,
} from "./intake-redeliver.js";

export type {
  IntakeRedelivery,
  IntakeRedeliveryInput,
} from "./intake-redeliver.js";

export const MASKED_INTEREST_VALUE = "redacted";

const implementedJoinInterest = implement(joinInterestContract, (input) =>
  input.email === MASKED_INTEREST_VALUE ||
  input.ticket === MASKED_INTEREST_VALUE
    ? Effect.fail(
        new MaskedInterestReplay({
          message:
            "Cannot replay a redacted interest card. Submit a new human-approved card with a fresh ticket.",
        })
      )
    : JoinInterest.pipe(Effect.flatMap((intake) => intake.submit(input)))
);

const joinOutcomes = {
  [JOIN_ANSWER]: "accepted",
  [JOIN_BUSY]: "busy",
  [JOIN_DELAYED]: "saved_mail_delayed",
  [JOIN_NOT_OPEN]: "not_open",
} as const satisfies Record<JoinOutput["message"], string>;

export const joinInterest = {
  ...implementedJoinInterest,
  handler: (input: JoinInput) =>
    Effect.gen(function* privateInterestCall() {
      const watch = yield* CallWatch;

      const around: Around = (contract, _input, run) => {
        let result: Option.Option<Effect.Success<typeof run>> = Option.none();

        return watch
          .around(
            contract,
            {
              agentRef: MASKED_INTEREST_VALUE,
              answers: MASKED_INTEREST_VALUE,
              consent: {
                contact: input.consent.contact,
                share: input.consent.share ?? false,
              },
              email: MASKED_INTEREST_VALUE,
              name: MASKED_INTEREST_VALUE,
              ticket: MASKED_INTEREST_VALUE,
              x: MASKED_INTEREST_VALUE,
            },
            run.pipe(
              Effect.tap((output) =>
                Effect.sync(() => {
                  result = Option.some(output);
                })
              ),
              Effect.as({
                message: JOIN_ANSWER,
                statusRef: MASKED_INTEREST_VALUE,
              })
            )
          )
          .pipe(
            Effect.flatMap(() =>
              Option.isSome(result)
                ? Effect.succeed(result.value)
                : Effect.die(
                    new Error("interest observer did not run the call")
                  )
            )
          );
      };

      return yield* implementedJoinInterest.handler(input).pipe(
        Effect.provideService(CallWatch, { around }),
        Effect.tap((output) =>
          Effect.logInfo("joinInterest outcome", {
            outcome: joinOutcomes[output.message],
          })
        ),
        Effect.tapCause(() =>
          Effect.logWarning("joinInterest outcome", { outcome: "failed" })
        )
      );
    }),
};

export {
  JoinContactStore,
  JoinContactSchema,
  withPending,
  withState,
} from "./join-contact-store.js";

export type {
  JoinContact,
  JoinContactPending,
  JoinContactState,
} from "./join-contact-store.js";

export { JoinRequest, joinIntakeLayer } from "./join-intake.js";

export { JoinDeliveryDeadline } from "./join-delivery-machine.js";

export { IntakeSweep, SWEEP_CONCURRENCY } from "./intake-sweep.js";

export type { IntakeSweepCounts, IntakeSweepOutcome } from "./intake-sweep.js";

export {
  JOIN_ANSWER,
  JOIN_BUSY,
  JOIN_DELAYED,
  JOIN_NOT_OPEN,
  JoinAnswers,
  joinInterestContract,
} from "./join-interest-contract.js";

export type { JoinInput, JoinOutput } from "./join-interest-contract.js";
