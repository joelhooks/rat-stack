import { VerdictSchema } from "@rat-stack/check-harness";
import { Schema } from "effect";

import { PlanRowsSchema, PlanRowSchema } from "./plan.js";

export const DeployInputSchema = Schema.Struct({
  allow: Schema.Array(PlanRowSchema),
  mode: Schema.Literals(["plan", "prod"]),
  ownerApproved: Schema.optionalKey(Schema.Boolean),
  profile: Schema.NonEmptyString,
});

export type DeployInput = typeof DeployInputSchema.Type;

export const ApplyReceiptSchema = Schema.Struct({
  appliedAt: Schema.optionalKey(Schema.Natural),
  contentGeneration: Schema.optionalKey(Schema.NonEmptyString),
  notUpdated: Schema.Array(Schema.String),
  outcome: Schema.Literals([
    "prepared",
    "applied",
    "failed",
    "partial",
    "crashed",
  ]),
  previousVersions: Schema.optionalKey(
    Schema.Record(Schema.String, Schema.String)
  ),
  retainedOrphans: Schema.Array(Schema.String),
  updated: Schema.Array(Schema.String),
  versions: Schema.Record(Schema.String, Schema.String),
});

export type ApplyReceipt = typeof ApplyReceiptSchema.Type;

export const PreparedPlanSchema = Schema.Struct({
  receipt: ApplyReceiptSchema,
  rows: PlanRowsSchema,
});

export type PreparedPlan = typeof PreparedPlanSchema.Type;

export class DeployStepError extends Schema.TaggedError<DeployStepError>()(
  "DeployStepError",
  {
    keys: Schema.Array(Schema.String),
    reason: Schema.String,
    step: Schema.Literals(["preflight", "plan", "apply", "checks"]),
  }
) {}

export const DeployVerdictSchema = Schema.Struct({
  checks: Schema.Array(VerdictSchema),
  keys: Schema.Array(Schema.String),
  outcome: Schema.Literals([
    "planned",
    "healthy",
    "refused",
    "failed",
    "partial",
    "crashed",
    "unknown",
  ]),
  reason: Schema.optional(Schema.String),
  receipt: Schema.optional(ApplyReceiptSchema),
  rows: Schema.Array(PlanRowSchema),
  step: Schema.String,
});

export type DeployVerdict = typeof DeployVerdictSchema.Type;
