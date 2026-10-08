import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import {
  CardSchema,
  LearnContextSchema,
  LearnDepthSchema,
  LearnError,
  LearnEventSchema,
  LearnPreferencesChangeSchema,
  LearnPreferencesSchema,
  LearnSelectionSchema,
  ProgressSchema,
  SuppliedProgressSchema,
} from "./learn-model.js";

export const learnDeckContract = defineContract("learnDeck", {
  annotations: { idempotent: true, readOnly: true },
  description: "List the public, source-derived concept deck.",
  failure: LearnError,
  input: Schema.Struct({}),
  output: Schema.Struct({
    cards: Schema.Array(CardSchema),
    version: Schema.Literal(1),
  }),
});

export const learnCardContract = defineContract("learnCard", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read one concept card at the requested explanation depth.",
  failure: LearnError,
  input: Schema.Struct({ depth: LearnDepthSchema, id: CardSchema.fields.id }),
  output: Schema.Struct({ card: CardSchema, depth: LearnDepthSchema }),
});

export const learnNextContract = defineContract("learnNext", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Select concepts in play, resolving unintroduced prerequisites first. Without context, offer the next concept in deck order. Omitted progress means none yet. Selection records no presentation.",
  failure: LearnError,
  input: Schema.Struct({
    context: Schema.optional(LearnContextSchema),
    progress: SuppliedProgressSchema,
  }),
  output: LearnSelectionSchema,
});

export const learnRecordContract = defineContract("learnRecord", {
  annotations: { idempotent: false, readOnly: true },
  description:
    "Fold a presentation or learning event into supplied progress; omitted progress means none yet. The public server stores nothing.",
  failure: LearnError,
  input: Schema.Struct({
    event: LearnEventSchema,
    progress: SuppliedProgressSchema,
  }),
  output: ProgressSchema,
});

export const learnPreferencesContract = defineContract("learnPreferences", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read local display preferences: width, visual style and snippet terseness. Without a preferences file, the default is narrow inline text with full snippets. Preferences never leave the machine.",
  failure: LearnError,
  input: Schema.Struct({}),
  output: LearnPreferencesSchema,
});

export const learnSetPreferencesContract = defineContract(
  "learnSetPreferences",
  {
    annotations: { idempotent: true, readOnly: false },
    description:
      "Change local display preferences when the operator asks. Omitted fields keep their current value.",
    failure: LearnError,
    input: LearnPreferencesChangeSchema,
    output: LearnPreferencesSchema,
  }
);
