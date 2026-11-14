import { firstPackageExercise } from "#shared/first-package/exercise.ts";

// The check is supplied (shared/first-package/). It looks at the repo from the
// outside: git, a fresh Pi and the root folder. What you build lives wherever
// you put it, not here.
export default firstPackageExercise({
  id: "01.1",
  title: "Don't take its word for it",
});
