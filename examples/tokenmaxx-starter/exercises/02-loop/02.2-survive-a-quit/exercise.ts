import { ownLoopExercise } from "#shared/own-loop/exercise.ts";
import { judgeSurviveFrom } from "#shared/own-loop/survive.ts";

// The same job as 02.1 (shared/own-loop/). The done check also reads which
// Pi session did what, from the launcher's records.
export default ownLoopExercise({
  id: "02.2",
  title: "Survive a quit",
  judge: judgeSurviveFrom,
  donePass:
    "Done: a later session picked up the result on its own, once, and nothing stale.",
});
