import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { LearnError } from "./learn-model.js";

export class LearnUnauthenticated extends Schema.TaggedError<LearnUnauthenticated>()(
  "Unauthenticated",
  { message: Schema.String }
) {}

const FeedbackAuthFailure = LearnUnauthenticated.annotate({
  httpApiStatus: 401,
});

export const FeedbackGrant = Schema.Struct({
  expiresAt: Schema.Finite,
  id: Schema.String,
  personId: Schema.String,
});

export const FeedbackDevice = Schema.Union([
  Schema.Struct({ grant: FeedbackGrant, state: Schema.Literal("approved") }),
  Schema.Struct({
    interval: Schema.Finite,
    state: Schema.Literals(["pending", "denied", "expired", "polled-too-fast"]),
  }),
]);

export const FeedbackCredential = Schema.Union([
  Schema.Struct({ personId: Schema.String, state: Schema.Literal("active") }),
  Schema.Struct({ state: Schema.Literals(["expired", "unauthenticated"]) }),
]);

export const FeedbackRequest = Schema.Struct({
  deviceCode: Schema.String,
  expiresIn: Schema.Finite,
  interval: Schema.Finite,
  userCode: Schema.String,
  verificationUrl: Schema.String,
});

export const FeedbackPoll = Schema.Union([
  Schema.Struct({
    expiresAt: Schema.Finite,
    state: Schema.Literal("approved"),
    token: Schema.String,
  }),
  Schema.Struct({
    interval: Schema.Finite,
    state: Schema.Literals(["pending", "denied", "expired", "polled-too-fast"]),
  }),
]);

export const FeedbackInput = Schema.Struct({
  cardId: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(200)),
  feedback: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(2000)),
  token: Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(4096)),
});

export const learnFeedbackStartContract = defineContract("learnFeedbackStart", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Request a code for a person to approve learn feedback on their phone. No sign-in token is returned.",
  failure: FeedbackAuthFailure,
  input: Schema.Struct({}),
  output: FeedbackRequest,
});

export const learnFeedbackPollContract = defineContract("learnFeedbackPoll", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Poll a device code. Approval returns a credential that authorizes learnFeedback only.",
  failure: FeedbackAuthFailure,
  input: Schema.Struct({
    deviceCode: Schema.String.check(
      Schema.isNonEmpty(),
      Schema.isMaxLength(200)
    ),
  }),
  output: FeedbackPoll,
});

export const learnFeedbackContract = defineContract("learnFeedback", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Store feedback on a public learn card against the person who approved this feedback-only credential.",
  failure: Schema.Union([FeedbackAuthFailure, LearnError]),
  input: FeedbackInput,
  output: Schema.Struct({ id: Schema.String }),
});
