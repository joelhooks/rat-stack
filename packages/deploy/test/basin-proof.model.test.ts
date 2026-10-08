import { expect, it } from "@effect/vitest";
import { watchActor } from "@rat-stack/capability/actor-watch";
import { createEffectActor, join, waitFor } from "@xstate/effect";
import { Deferred, Effect, Match, Ref, Schema } from "effect";

import {
  BasinProof,
  BasinProofFailure,
  basinProofMachine,
} from "../src/basin-proof-machine.js";

const CommandsSchema = Schema.Array(
  Schema.Literals(["complete", "fail", "observe"])
);

const CountsSchema = Schema.Struct({
  parquetGone: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  rowsRemaining: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  rowsWritten: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  snapshotsExpired: Schema.Int.check(
    Schema.isBetween({ maximum: 3, minimum: 0 })
  ),
});

type State = "planning" | "creating" | "proving" | "destroying" | "settled";

interface Model {
  readonly state: State;
  readonly created: number;
  readonly destroyed: number;
  readonly failed: boolean;
  readonly proven: boolean;
}

const completion = (state: State, failed: boolean, created: number) =>
  Match.value(state).pipe(
    Match.when("creating", () => (failed ? 3 : 5)),
    Match.when("destroying", () => (failed ? 1 : created)),
    Match.orElse(() => 0)
  );

const advance = (model: Model, failed: boolean, valid: boolean): Model =>
  Match.value(model.state).pipe(
    Match.when(
      "planning",
      () =>
        ({
          ...model,
          failed,
          state: failed ? "settled" : "creating",
        }) satisfies Model
    ),
    Match.when(
      "creating",
      () =>
        ({
          ...model,
          created: failed ? 3 : 5,
          failed,
          state: failed ? "destroying" : "proving",
        }) satisfies Model
    ),
    Match.when(
      "proving",
      () =>
        ({
          ...model,
          failed: failed || !valid,
          proven: !failed,
          state: "destroying",
        }) satisfies Model
    ),
    Match.when(
      "destroying",
      () =>
        ({
          ...model,
          destroyed: failed ? 1 : model.created,
          failed: failed || model.failed,
          state: "settled",
        }) satisfies Model
    ),
    Match.orElse(() => model)
  );

it.effect.prop(
  "failed creation or erasure still destroys the approved set, and markers without physical deletion cannot pass",
  { commands: CommandsSchema, counts: CountsSchema },
  ({ commands, counts }) =>
    Effect.gen(function* modelTest() {
      const gates = {
        creating: yield* Deferred.make<number, BasinProofFailure>(),
        destroying: yield* Deferred.make<number, BasinProofFailure>(),
        planning: yield* Deferred.make<number, BasinProofFailure>(),
        proving: yield* Deferred.make<number, BasinProofFailure>(),
      };

      const calls = yield* Ref.make<readonly string[]>([]);

      const work = (state: keyof typeof gates) =>
        Ref.update(calls, (seen) => [...seen, state]).pipe(
          Effect.andThen(Deferred.await(gates[state]))
        );

      const actor = yield* createEffectActor(basinProofMachine).pipe(
        Effect.provideService(BasinProof, {
          create: () => work("creating"),
          destroy: () => work("destroying"),
          plan: () => work("planning").pipe(Effect.asVoid),
          prove: () => work("proving").pipe(Effect.as(counts)),
        })
      );

      yield* watchActor("basinProofMachine", actor);

      let model: Model = {
        created: 0,
        destroyed: 0,
        failed: false,
        proven: false,
        state: "planning",
      };

      const history: string[] = ["planning"];

      const valid =
        counts.rowsWritten === 3 &&
        counts.rowsRemaining === 1 &&
        counts.snapshotsExpired > 0 &&
        counts.parquetGone > 0;

      for (const command of [
        ...commands,
        "complete",
        "complete",
        "complete",
        "complete",
      ]) {
        if (model.state === "settled" || command === "observe") {
          expect(actor.getSnapshot().value).toBe(model.state);
          continue;
        }

        const completed = completion(
          model.state,
          command === "fail",
          model.created
        );

        yield* command === "fail"
          ? Deferred.fail(
              gates[model.state],
              new BasinProofFailure({ completed, reason: "engine-failed" })
            )
          : Deferred.succeed(gates[model.state], completed);

        model = advance(model, command === "fail", valid);
        const expectedState = model.state;
        yield* waitFor(actor, (snapshot) => snapshot.matches(expectedState));

        if (model.state !== "settled") {
          history.push(model.state);
        }
      }

      // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- unknown machine failures remain defects; operation failures are asserted from the output.
      const output = yield* join(actor).pipe(Effect.orDie);
      expect(output.created).toBe(model.created);
      expect(output.destroyed).toBe(model.destroyed);
      expect(output.failure !== undefined).toBe(model.failed);
      expect(output.counts).toEqual(
        model.proven
          ? counts
          : {
              parquetGone: 0,
              rowsRemaining: 0,
              rowsWritten: 0,
              snapshotsExpired: 0,
            }
      );
      expect(yield* Ref.get(calls)).toEqual(history);
    }),
  { arbitrary: { runs: 100 } }
);
