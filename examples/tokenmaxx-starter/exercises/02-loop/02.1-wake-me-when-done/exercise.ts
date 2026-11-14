import { ownLoopExercise } from "#shared/own-loop/exercise.ts";

// The job and its commands are supplied (shared/own-loop/). What you build to
// wait for it lives wherever you put it, not here.
export default ownLoopExercise({
  id: "02.1",
  title: "Wake me when it's done",
  catchUp: true,
});
