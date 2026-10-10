import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

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
  failure: Schema.Union([InvalidFlagValue, UnknownFlag]),
  input: Schema.Struct({ context: FlagContextSchema, name: Schema.String }),
  output: Schema.Json,
});
