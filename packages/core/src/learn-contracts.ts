import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import {
  CardSchema,
  LearnContextSchema,
  LearnDepthSchema,
  LearnError,
  LearnEventSchema,
  LearnSelectionSchema,
  ProgressSchema,
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
    "Select explanations for concept ids in play. Returns progress without recording a presentation.",
  failure: LearnError,
  input: Schema.Struct({
    context: LearnContextSchema,
    progress: ProgressSchema,
  }),
  output: LearnSelectionSchema,
});

export const learnRecordContract = defineContract("learnRecord", {
  annotations: { idempotent: false, readOnly: true },
  description:
    "Fold a presentation or learning event into supplied progress. The public server stores nothing.",
  failure: LearnError,
  input: Schema.Struct({ event: LearnEventSchema, progress: ProgressSchema }),
  output: ProgressSchema,
});
