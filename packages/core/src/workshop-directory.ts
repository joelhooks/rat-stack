import { implement } from "@rat-stack/capability/implement";
import { Context, Effect, Layer } from "effect";

import { AssetReadError } from "./asset-read-error.js";
import type { WorkshopPublicData } from "./tokenmaxx-workshop.js";
import {
  currentExerciseContract,
  listExercisesContract,
  readExerciseContract,
  workshopLinksContract,
  workshopPrepContract,
  workshopScheduleContract,
} from "./workshop-contracts.js";

export class WorkshopDirectory extends Context.Service<
  WorkshopDirectory,
  {
    readonly data: Effect.Effect<
      typeof WorkshopPublicData.Type,
      AssetReadError
    >;
  }
>()("rat-stack/WorkshopDirectory") {
  static readonly layer = (data: typeof WorkshopPublicData.Type) =>
    Layer.succeed(WorkshopDirectory, { data: Effect.succeed(data) });
}

const handlers = Effect.tryPromise({
  catch: (cause) =>
    new AssetReadError({
      cause,
      path: "workshop-handlers",
      reason: "provider",
    }),
  try: () => import("./workshop-handlers.js"),
});

export const workshopSchedule = implement(workshopScheduleContract, () =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.workshopSchedule()))
);

export const workshopPrep = implement(workshopPrepContract, () =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.workshopPrep()))
);

export const workshopLinks = implement(workshopLinksContract, () =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.workshopLinks()))
);

export const listExercises = implement(listExercisesContract, () =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.listExercises()))
);

export const readExercise = implement(readExerciseContract, (input) =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.readExercise(input)))
);

export const currentExercise = implement(currentExerciseContract, (input) =>
  handlers.pipe(Effect.flatMap((loaded) => loaded.currentExercise(input)))
);

export const workshopCapabilities = [
  workshopSchedule,
  workshopPrep,
  workshopLinks,
  listExercises,
  readExercise,
  currentExercise,
] as const;
