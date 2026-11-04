import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { AssetReadError } from "./asset-read-error.js";
import {
  CurrentExercise,
  ExerciseList,
  PublishedExercise,
  WorkshopLinks,
  WorkshopPrep,
  WorkshopSchedule,
} from "./tokenmaxx-workshop-contracts.js";

export class UnknownExercise extends Schema.TaggedError<
  UnknownExercise,
  { readonly brand: unique symbol }
>()("UnknownExercise", { id: Schema.String, message: Schema.String }) {}

export const workshopScheduleContract = defineContract("workshopSchedule", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read workshop runs and UTC blocks.",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: WorkshopSchedule,
});

export const workshopPrepContract = defineContract("workshopPrep", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read published workshop prep.",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: WorkshopPrep,
});

export const workshopLinksContract = defineContract("workshopLinks", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read published workshop links.",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: WorkshopLinks,
});

export const listExercisesContract = defineContract("listExercises", {
  annotations: { idempotent: true, readOnly: true },
  description: "List published workshop exercises.",
  failure: AssetReadError,
  input: Schema.Struct({}),
  output: ExerciseList,
});

export const readExerciseContract = defineContract("readExercise", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read a published exercise.",
  failure: Schema.Union([UnknownExercise, AssetReadError]),
  input: Schema.Struct({ id: Schema.String }),
  output: PublishedExercise,
});

export const currentExerciseContract = defineContract("currentExercise", {
  annotations: { idempotent: true, readOnly: true },
  description: "Read the current block for a run's ISO date.",
  failure: AssetReadError,
  input: Schema.Struct({ run: Schema.String }),
  output: CurrentExercise,
});
