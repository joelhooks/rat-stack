import { describe, expect, it } from "@effect/vitest";
import {
  createEffectActor,
  EffectFailure,
  join,
  send,
  waitFor,
} from "@xstate/effect";
import { sendAndAwait } from "@xstate/effect/test";
import { Cause, Deferred, Effect, Exit, Match, Result, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import type { SnapshotFrom } from "xstate";
import { getPathsFromEvents, getShortestPaths } from "xstate/graph";

import { FileInspector } from "../src/file-inspector.js";
import {
  inspectMachine,
  inspectOutcome,
  runInspectMachine,
} from "../src/inspect-machine.js";
import type { InspectOutcome } from "../src/inspect-machine.js";
import { FileStatsError, FileStatsSchema } from "../src/stats.js";

const Scenario = Schema.Struct({
  fails: Schema.Boolean,
  reason: Schema.String,
  stats: FileStatsSchema,
});

const Command = Schema.Literals(["succeed", "fail", "probe"]);

const commands = Arbitrary.array(Arbitrary.schema(Command), { maxLength: 30 });

type InspectionScenario = typeof Scenario.Type;

type InspectionCommand = typeof Command.Type;

const outcomesFor = ({ stats, reason }: InspectionScenario) =>
  ({
    failure: inspectOutcome.Unreadable({
      cause: Cause.fail(new FileStatsError({ path: stats.path, reason })),
    }),
    success: inspectOutcome.Inspected({ stats }),
  }) satisfies { failure: InspectOutcome; success: InspectOutcome };

const eventsFor = (scenario: InspectionScenario) => {
  const { failure, success } = outcomesFor(scenario);
  const invocation = inspectMachine.states.reading?.invoke[0];

  if (invocation === undefined) {
    throw new Error("inspection must invoke its work");
  }

  return {
    fail: {
      actorId: invocation.id,
      error: new EffectFailure(failure.cause),
      type: "xstate.error.actor",
    },
    probe: { type: "UNHANDLED" },
    succeed: {
      actorId: invocation.id,
      output: success.stats,
      type: "xstate.done.actor",
    },
  };
};

const domainOutcome = (outcome: InspectOutcome | undefined) =>
  outcome?._tag === "Unreadable"
    ? {
        _tag: outcome._tag,
        error: Result.getOrThrow(Cause.findError(outcome.cause)),
      }
    : outcome;

const assertSnapshot = (
  snapshot: SnapshotFrom<typeof inspectMachine>,
  expected?: InspectOutcome
) => {
  expect(snapshot.status).toBe(expected === undefined ? "active" : "done");
  expect(domainOutcome(snapshot.context.outcome)).toStrictEqual(
    domainOutcome(expected)
  );
  expect(domainOutcome(snapshot.output)).toStrictEqual(domainOutcome(expected));

  if (snapshot.output?._tag === "Unreadable") {
    expect(Schema.is(FileStatsError)(Cause.squash(snapshot.output.cause))).toBe(
      true
    );
  }
};

const replayModel = (
  scenario: InspectionScenario,
  generated: readonly InspectionCommand[]
) => {
  const events = eventsFor(scenario);
  const outcomes = outcomesFor(scenario);

  const paths = getPathsFromEvents(
    inspectMachine,
    generated
      .slice(
        0,
        generated.findIndex((command) => command !== "probe") + 1 ||
          generated.length
      )
      .map((command) => events[command]),
    { input: { path: scenario.stats.path } }
  );

  expect(paths).toHaveLength(1);

  for (const path of paths) {
    let expected: InspectOutcome | undefined;

    for (const [index, step] of path.steps.entries()) {
      const command = generated[index - 1];

      if (expected === undefined && command === "succeed") {
        expected = outcomes.success;
      }

      if (expected === undefined && command === "fail") {
        expected = outcomes.failure;
      }

      assertSnapshot(step.state, expected);
    }
  }
};

const replayActor = Effect.fn("replayActor")(function* replayActor(
  scenario: InspectionScenario,
  generated: readonly InspectionCommand[]
) {
  const { failure, success } = outcomesFor(scenario);
  const events = eventsFor(scenario);
  let expected: InspectOutcome | undefined;
  const result = yield* Deferred.make<typeof scenario.stats, FileStatsError>();
  const requested: string[] = [];

  const inspector = FileInspector.of({
    inspect: (path) => {
      requested.push(path);

      return Deferred.await(result);
    },
  });

  const actor = yield* createEffectActor(inspectMachine, {
    input: { path: scenario.stats.path },
  }).pipe(Effect.provideService(FileInspector, inspector));

  yield* waitFor(actor, (snapshot) => snapshot.status === "active");
  assertSnapshot(actor.getSnapshot());

  const sequence: readonly InspectionCommand[] = [
    ...generated,
    scenario.fails ? "fail" : "succeed",
    ...generated,
    "succeed",
    "fail",
  ];

  for (const command of sequence) {
    const before = actor.getSnapshot();

    if (expected === undefined && command === "fail") {
      expected = failure;
      yield* Deferred.failCause(result, failure.cause);
      yield* waitFor(actor, (snapshot) => snapshot.status === "done");
    } else if (expected === undefined && command === "succeed") {
      expected = success;
      yield* Deferred.succeed(result, success.stats);
      yield* waitFor(actor, (snapshot) => snapshot.status === "done");
    } else {
      const event = events[command];

      yield* before.status === "active"
        ? sendAndAwait(actor, event)
        : send(actor, event);

      expect(actor.getSnapshot()).toBe(before);
    }

    assertSnapshot(actor.getSnapshot(), expected);
  }

  expect(requested).toStrictEqual([scenario.stats.path]);
  // @effect-diagnostics-next-line anyUnknownInErrorContext:off -- Machine-level failures are defects; FileStatsError travels through the final outcome.
  expect(domainOutcome(yield* join(actor).pipe(Effect.orDie))).toStrictEqual(
    domainOutcome(expected)
  );

  const running = runInspectMachine(scenario.stats.path).pipe(
    Effect.provideService(FileInspector, inspector)
  );

  if (expected?._tag === "Unreadable") {
    expect(yield* Effect.flip(running)).toStrictEqual(
      Cause.squash(failure.cause)
    );
  } else {
    expect(yield* running).toStrictEqual(success.stats);
  }
}, Effect.scoped);

describe("inspection lifecycle contract", () => {
  it.effect.prop(
    "preserves typed failures, defects and interruption through invoked errors",
    {
      kind: Schema.Literals(["failure", "defect", "interruption"]),
      reason: Schema.String,
    },
    ({ kind, reason }) =>
      Effect.gen(function* preservesCause() {
        const error = new FileStatsError({ path: "generated.txt", reason });

        const cause = Match.value(kind).pipe(
          Match.when("failure", () => Cause.fail(error)),
          Match.when("defect", () => Cause.die(error)),
          Match.when("interruption", () => Cause.interrupt()),
          Match.exhaustive
        );

        const inspector = FileInspector.of({
          inspect: () => Effect.failCause(cause),
        });

        const exit = yield* runInspectMachine(error.path).pipe(
          Effect.provideService(FileInspector, inspector),
          Effect.exit
        );

        expect(Exit.isFailure(exit)).toBe(true);

        if (Exit.isFailure(exit)) {
          expect(exit.cause.reasons.map((entry) => entry._tag)).toStrictEqual(
            cause.reasons.map((entry) => entry._tag)
          );

          if (kind === "failure") {
            expect(Result.getOrThrow(Cause.findError(exit.cause))).toBe(error);
          } else if (kind === "defect") {
            expect(Result.getOrThrow(Cause.findDefect(exit.cause))).toBe(error);
          }
        }
      }),
    { arbitrary: { runs: 100 } }
  );
  it.prop(
    "graph paths preserve one terminal outcome across generated command histories",
    { generated: commands, scenario: Scenario },
    ({ generated, scenario }) => {
      replayModel(scenario, generated);
      const events = eventsFor(scenario);

      const terminalPaths = getShortestPaths(inspectMachine, {
        events: [events.succeed, events.fail],
        input: { path: scenario.stats.path },
        toState: (snapshot) => snapshot.status === "done",
      });

      expect(terminalPaths).toHaveLength(2);

      for (const path of terminalPaths) {
        const history = path.steps
          .slice(1)
          .map((step) =>
            step.event.type === "xstate.done.actor" ? "succeed" : "fail"
          );

        replayModel(scenario, [...history, ...generated]);
      }
    },
    { arbitrary: { runs: 200 } }
  );

  it.effect.prop(
    "real actor preserves generated input, typed outcomes and terminal immutability",
    { generated: commands, scenario: Scenario },
    ({ generated, scenario }) => replayActor(scenario, generated),
    { arbitrary: { runs: 200 } }
  );
});
