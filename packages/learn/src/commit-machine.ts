import { watchActor } from "@rat-stack/capability/actor-watch";
import { LearnEventSchema } from "@rat-stack/core/learn";
import type { LearnEvent, LearnerProgressError } from "@rat-stack/core/learn";
import {
  createEffectActor,
  fromEffect,
  join,
  setupEffect,
} from "@xstate/effect";
import { Effect } from "effect";
import { types } from "xstate";

import { LearnEventWriter } from "./event-writer.js";

interface CommitContext {
  readonly event: LearnEvent;
  readonly error: LearnerProgressError | undefined;
}

const append = fromEffect({
  effect: ({ input }) => LearnEventWriter.use((writer) => writer.append(input)),
  schemas: { input: LearnEventSchema },
});

const commitMachine = setupEffect({
  actors: { append },
  schemas: { context: types<CommitContext>(), input: LearnEventSchema },
}).createMachine({
  context: ({ input }) => ({ error: undefined, event: input }),
  initial: "appending",
  output: ({ context }) => context.error,
  states: {
    appending: {
      invoke: {
        input: ({ context }) => context.event,
        onDone: { target: "committed" },
        onError: {
          context: ({ event }) => ({ error: event.error }),
          target: "failed",
        },
        src: "append",
      },
    },
    committed: { type: "final" },
    failed: { type: "final" },
  },
});

export const commitEvent = Effect.fn("commitEvent")(function* commitEvent(
  event: LearnEvent
) {
  const actor = yield* createEffectActor(commitMachine, { input: event });
  yield* watchActor("learnLogCommit", actor);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Unexpected machine failures are defects; the typed append failure travels through the final output.
  const error = yield* join(actor).pipe(Effect.orDie);

  if (error !== undefined) {
    return yield* error;
  }

  return yield* Effect.void;
}, Effect.scoped);
