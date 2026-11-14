import { splitExercise } from "#shared/split-job/exercise.ts";

// The job, its scripted worker and its commands are supplied
// (shared/split-job/). Whatever you build to split it lives wherever you put
// it, not here.
export default splitExercise({
  id: "06.1",
  title: "Split three ways",
});
