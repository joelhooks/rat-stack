import { watchActor } from "@rat-stack/capability/actor-watch";
import type { ConceptProgress } from "@rat-stack/core/learn";
import { createEffectActor, waitFor } from "@xstate/effect";
import { Effect } from "effect";

import { progressMachine } from "./progress-machine.js";
import { explanationDepth } from "./progress.js";

export const evaluateConcept = Effect.fn("evaluateConcept")(
  function* evaluateConcept(
    progress: ConceptProgress,
    at: number,
    asked: boolean
  ) {
    const actor = yield* createEffectActor(progressMachine, {
      input: { at, progress },
    });

    yield* watchActor("learnerProgress", actor);

    const snapshot = yield* waitFor(
      actor,
      (state) => state.value !== "clock" && state.value !== "routing"
    ).pipe(Effect.orDie);

    return explanationDepth(
      snapshot.context.progress,
      snapshot.context.at,
      asked
    );
  },
  Effect.scoped
);
