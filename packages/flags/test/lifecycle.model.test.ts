import { expect, it } from "@effect/vitest";
import { send, waitFor } from "@xstate/effect";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { FlagLifecycleJournal, startFlagLifecycle } from "../src/lifecycle.js";

const Command = Schema.Literals(["ROLLOUT", "ENABLE", "REMOVE"]);

const commands = Arbitrary.array(Arbitrary.schema(Command), { maxLength: 40 });

it.effect.prop(
  "generated histories follow the lifecycle and never change a removed flag",
  {
    commands,
    name: Schema.NonEmptyString,
  },
  ({ commands: generated, name }) =>
    Effect.gen(function* replayFlagHistory() {
      const actor = yield* startFlagLifecycle(name);
      const journal = yield* FlagLifecycleJournal;
      let position = 0;
      const stages = ["rollingOut", "on", "removed"] as const;
      const states = ["declared", ...stages];
      const legal = ["ROLLOUT", "ENABLE", "REMOVE"];

      const recorded: {
        name: string;
        stage: "rollingOut" | "on" | "removed";
      }[] = [];

      const sequence: readonly (typeof Command.Type)[] = [
        ...generated,
        "ROLLOUT",
        "ENABLE",
        "REMOVE",
        ...generated,
      ];

      for (const command of sequence) {
        const expectedCommand = legal[position];
        yield* send(actor, { type: command });

        if (command === expectedCommand) {
          position += 1;

          const stage = stages[position - 1];

          if (stage === undefined) {
            return yield* Effect.die(
              new Error("The lifecycle model exceeded its final state.")
            );
          }

          recorded.push({ name, stage });
          yield* waitFor(actor, (snapshot) => snapshot.value === stage);
        } else {
          yield* Effect.yieldNow;
        }

        expect(actor.getSnapshot().value).toBe(states[position]);
        expect(actor.getSnapshot().status).toBe(
          position === 3 ? "done" : "active"
        );
        expect(yield* journal.entries).toStrictEqual(recorded);
      }

      return yield* Effect.void;
    }).pipe(Effect.scoped, Effect.provide(FlagLifecycleJournal.memory))
);
