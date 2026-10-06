import { VerdictSchema } from "@rat-stack/check-harness";
import { Schema } from "effect";

import { ApplyReceiptSchema } from "./contracts.js";

export const RollbackInputSchema = Schema.Struct({
  profile: Schema.NonEmptyString,
  receipt: Schema.optionalKey(Schema.NonEmptyString),
});

export type RollbackInput = typeof RollbackInputSchema.Type;

export const RollbackSourceSchema = Schema.Struct({
  path: Schema.NonEmptyString,
  profile: Schema.NonEmptyString,
  receipt: ApplyReceiptSchema,
});

export type RollbackSource = typeof RollbackSourceSchema.Type;

export const RollbackReceiptSchema = Schema.Struct({
  checks: Schema.Array(VerdictSchema),
  completed: Schema.Array(Schema.NonEmptyString),
  observedAt: Schema.Natural,
  operation: Schema.Literal("rollback"),
  outcome: Schema.Literals([
    "restoring",
    "restored",
    "healthy",
    "failed",
    "unknown",
  ]),
  profile: Schema.NonEmptyString,
  source: RollbackSourceSchema,
  targets: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
  versions: Schema.Record(Schema.NonEmptyString, Schema.NonEmptyString),
});

export type RollbackReceipt = typeof RollbackReceiptSchema.Type;
