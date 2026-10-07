import { watchActor } from "@rat-stack/capability/actor-watch";
import {
  ConceptProgressSchema,
  LearnEventSchema,
  LearnTimestampSchema,
} from "@rat-stack/core/learn";
import type { ConceptProgress, LearnEvent } from "@rat-stack/core/learn";
import {
  createEffectActor,
  fromEffect,
  send,
  setupEffect,
  waitFor,
} from "@xstate/effect";
import { Clock, Effect, Schema } from "effect";
import { types } from "xstate";

import { foldConcept, isDecaying } from "./progress.js";

interface ProgressContext {
  readonly progress: ConceptProgress;
  readonly at: number;
  readonly revision: number;
  readonly hasExplicitTime: boolean;
}

const observeTime = fromEffect(Clock.currentTimeMillis);

export const progressMachine = setupEffect({
  actors: { observeTime },
  guards: {
    isDueForDecay: isDecaying,
    isFamiliar: (progress: ConceptProgress) => progress.familiarity === 2,
    isIntroduced: (progress: ConceptProgress) => progress.familiarity === 1,
    isNew: (progress: ConceptProgress) => progress.familiarity === 0,
  },
  schemas: {
    context: types<ProgressContext>(),
    events: {
      ELAPSED: Schema.Struct({ at: LearnTimestampSchema }),
      RECORD: Schema.Struct({ event: LearnEventSchema }),
    },
    input: Schema.Struct({
      at: Schema.optional(LearnTimestampSchema),
      progress: ConceptProgressSchema,
    }),
  },
}).createMachine({
  context: ({ input }) => ({
    at: input.at ?? 0,
    hasExplicitTime: input.at !== undefined,
    progress: input.progress,
    revision: 0,
  }),
  initial: "clock",
  on: {
    ELAPSED: {
      context: ({ context, event }) => ({
        ...context,
        at: Math.max(context.at, event.at),
        revision: context.revision + 1,
      }),
      target: ".routing",
    },
    RECORD: {
      context: ({ context, event }) => ({
        ...context,
        at: Math.max(context.at, event.event.at),
        progress: foldConcept(context.progress, event.event),
        revision: context.revision + 1,
      }),
      target: ".routing",
    },
  },
  states: {
    clock: {
      invoke: {
        onDone: {
          context: ({ context, event }) => ({
            ...context,
            at: context.hasExplicitTime ? context.at : event.output,
          }),
          target: "routing",
        },
        src: "observeTime",
      },
    },
    decaying: {},
    familiar: {},
    fluent: {},
    introduced: {},
    new: {},
    routing: {
      always: ({ context, guards }) => {
        if (guards.isNew(context.progress)) {
          return { target: "new" };
        }

        if (guards.isDueForDecay(context.progress, context.at)) {
          return { target: "decaying" };
        }

        if (guards.isIntroduced(context.progress)) {
          return { target: "introduced" };
        }

        if (guards.isFamiliar(context.progress)) {
          return { target: "familiar" };
        }

        return { target: "fluent" };
      },
    },
  },
});

export const recordConcept = Effect.fn("recordConcept")(function* recordConcept(
  progress: ConceptProgress,
  event: LearnEvent
) {
  const actor = yield* createEffectActor(progressMachine, {
    input: { at: event.at, progress },
  });

  yield* watchActor("learnerProgress", actor);
  yield* waitFor(
    actor,
    (snapshot) => snapshot.value !== "clock" && snapshot.value !== "routing"
  ).pipe(Effect.orDie);
  yield* send(actor, { event, type: "RECORD" });

  const snapshot = yield* waitFor(
    actor,
    (state) => state.context.revision === 1
  ).pipe(Effect.orDie);

  return snapshot.context.progress;
}, Effect.scoped);
