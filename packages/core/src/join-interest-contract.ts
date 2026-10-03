import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { QuestionIdSchema } from "./intake-questions.js";
import { ApplicantName, ApplicantX } from "./join-identity.js";
import { MaskedInterestReplay } from "./masked-interest-replay.js";

export const JOIN_ANSWER = "Check your email for a link to confirm.";

export const JOIN_NOT_OPEN = "Agent signup is not open yet.";

const answer = Schema.String.check(Schema.isMaxLength(2000));

export const JoinAnswers = Schema.Record(
  QuestionIdSchema,
  Schema.optionalKey(answer)
);

export const joinInterestContract = defineContract("joinInterest", {
  annotations: { openWorld: true, readOnly: false },
  description:
    "Submit a human-approved workshop interest card. Ask the questions, never inspect the machine. Contact consent is required; sharing consent defaults to false. The status reference never reveals list membership. Confirmation is not a seat.",
  failure: MaskedInterestReplay,
  input: Schema.Struct({
    agentRef: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(256)
    ),
    answers: Schema.optionalKey(JoinAnswers),
    consent: Schema.Struct({
      contact: Schema.Literal(true),
      share: Schema.optionalKey(Schema.Boolean),
    }),
    email: Schema.String.check(Schema.isMaxLength(320)),
    name: Schema.optionalKey(ApplicantName),
    ticket: Schema.String.check(
      Schema.isMinLength(1),
      Schema.isMaxLength(4096)
    ),
    x: Schema.optionalKey(ApplicantX),
  }),
  output: Schema.Struct({
    message: Schema.Literals([JOIN_ANSWER, JOIN_NOT_OPEN]),
    statusRef: Schema.String,
  }),
});

export type JoinInput = typeof joinInterestContract.input.Type;

export type JoinOutput = typeof joinInterestContract.output.Type;
