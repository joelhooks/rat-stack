import { defineExercise } from "#shared/core/exercise.ts";

// Runner test fixture. Exit codes identify what ran.
export default defineExercise({
  id: "90.1",
  title: "Demo",
  commands: {
    setup: async () => 0,
    status: async (ctx) => (ctx.exerciseId === "90.1" ? 3 : 99),
    echo: async (_ctx, args) => args.length,
    boom: async () => {
      throw new Error("TODO: not done");
    },
  },
});
