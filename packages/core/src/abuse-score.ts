import { Context, Effect, Layer, Predicate, Schema } from "effect";

import { IntakeAnswersSchema } from "./intake-questions.js";
import { TicketClaimsSchema } from "./intake-ticket.js";

export const AbuseInputSchema = Schema.Struct({
  agentRef: Schema.String,
  answers: IntakeAnswersSchema,
  clientBucket: Schema.Struct({ ipHash: Schema.String, uaHash: Schema.String }),
  ticket: TicketClaimsSchema,
});

export type AbuseInput = typeof AbuseInputSchema.Type;

export const AbuseVerdictSchema = Schema.Struct({
  hold: Schema.Boolean,
  score: Schema.Finite.check(Schema.isBetween({ maximum: 1, minimum: 0 })),
  signals: Schema.Array(Schema.String),
});

export type AbuseVerdict = typeof AbuseVerdictSchema.Type;

export const SCORER_UNAVAILABLE = "scorer_unavailable";

export const cleanVerdict: AbuseVerdict = {
  hold: false,
  score: 0,
  signals: [],
};

export const scorerUnavailableVerdict: AbuseVerdict = {
  hold: true,
  score: 1,
  signals: [SCORER_UNAVAILABLE],
};

export class AbuseScore extends Context.Service<
  AbuseScore,
  { readonly score: (input: AbuseInput) => Effect.Effect<AbuseVerdict> }
>()("@rat-stack/core/AbuseScore") {
  static readonly testLayer = (
    verdict: AbuseVerdict | ((input: AbuseInput) => AbuseVerdict) = cleanVerdict
  ) =>
    Layer.succeed(this, {
      score: (input) =>
        Effect.succeed(
          Predicate.isFunction(verdict) ? verdict(input) : verdict
        ),
    });
}
