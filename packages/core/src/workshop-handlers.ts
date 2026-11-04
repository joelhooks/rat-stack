import { Clock, Effect } from "effect";

import {
  currentWorkshopExercise,
  exerciseSummary,
} from "./tokenmaxx-workshop.js";
import type { WorkshopPublicData } from "./tokenmaxx-workshop.js";
import { UnknownExercise } from "./workshop-contracts.js";
import { WorkshopDirectory } from "./workshop-directory.js";

const withData = <A>(select: (data: typeof WorkshopPublicData.Type) => A) =>
  WorkshopDirectory.use((directory) => directory.data.pipe(Effect.map(select)));

export const workshopSchedule = () => withData((data) => ({ runs: data.runs }));

export const workshopPrep = () => withData((data) => data.prep);

export const workshopLinks = () => withData((data) => data.links);

export const listExercises = () =>
  withData((data) => ({ exercises: data.exercises.map(exerciseSummary) }));

export const readExercise = ({ id }: { readonly id: string }) =>
  withData((data) =>
    data.exercises.find((exercise) => exercise.id === id)
  ).pipe(
    Effect.filterOrFail(
      (exercise) => exercise !== undefined,
      () =>
        new UnknownExercise({
          id,
          message: "Choose an id from listExercises.",
        })
    )
  );

export const currentExercise = ({ run }: { readonly run: string }) =>
  Clock.currentTimeMillis.pipe(
    Effect.flatMap((now) =>
      withData((data) => currentWorkshopExercise(data, run, now))
    )
  );
