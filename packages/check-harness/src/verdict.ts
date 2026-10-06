import { Schema } from "effect";

import { CheckRequestSchema } from "./request.js";

const evidence = {
  attention: Schema.optional(Schema.Literals(["page", "owner"])),
  check: Schema.NonEmptyString,
  counts: Schema.Record(Schema.NonEmptyString, Schema.Natural),
  deploymentVersion: Schema.optional(Schema.NonEmptyString),
  evaluationOnly: Schema.optional(Schema.Literal(true)),
  inputSource: Schema.optional(Schema.Literal("live-adapter")),
  observedAt: Schema.Natural,
  provenance: Schema.optional(
    Schema.Array(
      Schema.Struct({
        fetchedAt: Schema.Natural,
        id: Schema.NonEmptyString,
        source: Schema.NonEmptyString,
        status: Schema.NonEmptyString,
      })
    )
  ),
  reason: Schema.NonEmptyString,
  requestContext: Schema.optional(CheckRequestSchema),
  resourceVersion: Schema.optional(Schema.NonEmptyString),
};

export const VerdictSchema = Schema.Union([
  Schema.Struct({
    ...evidence,
    control: Schema.Natural,
    exitCode: Schema.Int,
    outcome: Schema.Literal("passed"),
    status: Schema.Literal("green"),
  }),
  Schema.Struct({
    ...evidence,
    control: Schema.Natural,
    exitCode: Schema.Int,
    outcome: Schema.Literal("not-settled"),
    status: Schema.Literals(["amber", "hold"]),
  }),
  Schema.Struct({
    ...evidence,
    control: Schema.Natural,
    exitCode: Schema.Int,
    outcome: Schema.Literal("failed"),
    status: Schema.Literal("red"),
  }),
  Schema.Struct({
    ...evidence,
    control: Schema.Literal(0),
    exitCode: Schema.Literal(3),
    outcome: Schema.Literal("errored"),
    status: Schema.Literal("hold"),
  }),
]);

export type Verdict = Schema.Schema.Type<typeof VerdictSchema>;
