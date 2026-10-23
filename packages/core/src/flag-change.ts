import { Schema } from "effect";

export const FlagPreviousValue = Schema.TaggedUnion({
  Known: { value: Schema.Json },
  Unavailable: { reason: Schema.String },
});

export const FlagChangeSchema = Schema.Struct({
  actor: Schema.String,
  attemptId: Schema.String,
  name: Schema.String,
  newValue: Schema.Json,
  oldValue: FlagPreviousValue,
  outcome: Schema.Literals([
    "Pending",
    "Succeeded",
    "Denied",
    "Failed",
    "Interrupted",
  ]),
  recordedAt: Schema.Int,
  scope: Schema.optionalKey(Schema.Json),
});

export const PendingFlagChangeSchema = Schema.Struct({
  ...FlagChangeSchema.fields,
  outcome: Schema.Literal("Pending"),
});

export const CompletedFlagChangeSchema = Schema.Struct({
  ...FlagChangeSchema.fields,
  outcome: Schema.Literals(["Succeeded", "Denied", "Failed", "Interrupted"]),
});

export type PendingFlagChange = typeof PendingFlagChangeSchema.Type;

export type CompletedFlagChange = typeof CompletedFlagChangeSchema.Type;

export type FlagChange = PendingFlagChange | CompletedFlagChange;

export const ListFlagChangesInput = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  name: Schema.optionalKey(Schema.String),
  scope: Schema.optionalKey(Schema.Json),
});

export const FlagChangesPage = Schema.Struct({
  changes: Schema.Array(
    Schema.Struct({ ...FlagChangeSchema.fields, ageMillis: Schema.Finite })
  ),
  cursor: Schema.optional(Schema.String),
});
