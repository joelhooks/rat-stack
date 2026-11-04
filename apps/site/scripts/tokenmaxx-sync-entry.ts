import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect } from "effect";

import { buildError, violation } from "./content-error.ts";
import { syncExercises } from "./tokenmaxx-sync.ts";

const [starter] = process.argv.slice(2);

const program =
  starter === undefined
    ? Effect.fail(
        buildError(
          "exercise sync",
          "starter",
          violation(
            "The starter path is missing.",
            "Exercise sync needs a local checkout to read.",
            "run `pnpm tokenmaxx:sync <starter path>`."
          )
        )
      )
    : syncExercises(starter, process.cwd()).pipe(
        Effect.flatMap((ids) => Effect.log(`Synced ${ids.length} exercises.`))
      );

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
