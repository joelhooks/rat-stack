import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { FlagChangesPage, ListFlagChangesInput } from "./flag-change.js";
import {
  FlagFlipRefused,
  FlagScopeMismatch,
  FlipFlagInput,
  RecordFlagEvidenceInput,
  FlagReceipt,
  FlagPosition,
} from "./flag-ladder.js";
import { FlagStorageError } from "./flag-storage-error.js";
import {
  FlagContextSchema,
  FlagMetadataSchema,
  InvalidFlagValue,
  UnknownFlag,
} from "./flags.js";

export const listFlagsContract = defineContract("listFlags", {
  annotations: { idempotent: true, readOnly: true },
  description: "List declared feature flags, their owners, and removal dates.",
  failure: Schema.Never,
  input: Schema.Struct({}),
  output: Schema.Array(FlagMetadataSchema),
});

export const getFlagContract = defineContract("getFlag", {
  annotations: { idempotent: true, readOnly: true },
  description: "Evaluate one declared feature flag for a subject.",
  failure: Schema.Union([
    InvalidFlagValue,
    UnknownFlag,
    FlagStorageError,
    FlagScopeMismatch,
  ]),
  input: Schema.Struct({ context: FlagContextSchema, name: Schema.String }),
  output: Schema.Json,
});

const flagWriteFailure = Schema.Union([
  UnknownFlag,
  InvalidFlagValue,
  FlagStorageError,
  FlagScopeMismatch,
  FlagFlipRefused,
]);

export const flipFeatureFlagContract = defineContract("flip_feature_flag", {
  annotations: { idempotent: false, readOnly: false },
  description:
    "Climb one declared rung using scoped evidence and approval, or flip off at any authority.",
  failure: flagWriteFailure,
  input: FlipFlagInput,
  needsApproval: true,
  output: FlagReceipt,
});

export const recordFlagEvidenceContract = defineContract(
  "record_flag_evidence",
  {
    annotations: { idempotent: false, readOnly: false },
    description:
      "Record a measured exit event at the current rung and exact read scope.",
    failure: flagWriteFailure,
    input: RecordFlagEvidenceInput,
    output: Schema.Void,
  }
);

export const readFlagLedgerContract = defineContract("read_flag_ledger", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read a bounded page of scoped attempts and the authoritative current rung.",
  failure: flagWriteFailure,
  input: Schema.Struct({
    ...ListFlagChangesInput.fields,
    name: Schema.NonEmptyString,
    scope: Schema.optionalKey(Schema.Json),
  }),
  output: Schema.Struct({ ...FlagChangesPage.fields, position: FlagPosition }),
});
