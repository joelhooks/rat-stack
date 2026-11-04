import { expect, it } from "@effect/vitest";
import { InMemoryService } from "alchemy/State/InMemoryState";
import type { ResourceState } from "alchemy/State/ResourceState";
import { StateStoreError } from "alchemy/State/State";
import type { StateService } from "alchemy/State/State";
import { Effect, Fiber, Result, Schema } from "effect";
import { TestClock } from "effect/testing";

import {
  copyStacks,
  maxWritesInFlight,
  parseStackList,
} from "../src/state-copy.js";

const StackName = Schema.String.check(Schema.isPattern(/^[A-Z][a-z]{0,3}$/u));

const StageName = Schema.String.check(Schema.isPattern(/^[a-z]{1,3}$/u));

const Fqn = Schema.String.check(Schema.isPattern(/^[a-z]{1,4}$/u));

const StageContents = Schema.Struct({
  fqns: Schema.Array(Fqn).check(Schema.isMaxLength(4)),
  output: Schema.Boolean,
});

const StoreEntries = Schema.Array(
  Schema.Tuple([
    StackName,
    Schema.Array(Schema.Tuple([StageName, StageContents])).check(
      Schema.isMaxLength(3)
    ),
  ])
).check(Schema.isMaxLength(4));

type Contents = Readonly<
  Record<string, Readonly<Record<string, typeof StageContents.Type>>>
>;

const contentsOf = (entries: typeof StoreEntries.Type): Contents =>
  Object.fromEntries(
    entries.map(([stack, stages]) => [stack, Object.fromEntries(stages)])
  );

const resource = (fqn: string): ResourceState => ({
  attr: {},
  bindings: [],
  downstream: [],
  fqn,
  instanceId: fqn,
  logicalId: fqn,
  namespace: undefined,
  props: {},
  providerVersion: 1,
  resourceType: "Test.Resource",
  status: "created",
});

interface StageOutput {
  readonly stage: string;
}

interface Recorded {
  readonly outputs: Record<string, Record<string, StageOutput>>;
  readonly state: Record<string, Record<string, Record<string, ResourceState>>>;
  readonly store: StateService;
  readonly writes: string[];
}

const recordedStore = (contents: Contents) =>
  Effect.gen(function* buildRecordedStore() {
    const state: Recorded["state"] = {};
    const outputs: Recorded["outputs"] = {};

    for (const [stack, stages] of Object.entries(contents)) {
      state[stack] = {};

      for (const [stage, { fqns, output }] of Object.entries(stages)) {
        state[stack][stage] = Object.fromEntries(
          fqns.map((fqn) => [fqn, resource(fqn)])
        );

        if (output) {
          outputs[stack] = { ...outputs[stack], [stage]: { stage } };
        }
      }
    }

    const inner = yield* InMemoryService(state, outputs);
    const writes: string[] = [];

    const store: StateService = {
      ...inner,
      delete: (request) =>
        Effect.sync(() => writes.push(`delete ${request.stack}`)).pipe(
          Effect.andThen(inner.delete(request))
        ),
      deleteStack: (request) =>
        Effect.sync(() => writes.push(`deleteStack ${request.stack}`)).pipe(
          Effect.andThen(inner.deleteStack(request))
        ),
      set: (request) =>
        Effect.sync(() => writes.push(`set ${request.stack}`)).pipe(
          Effect.andThen(inner.set(request))
        ),
      setOutput: (request) =>
        Effect.sync(() => writes.push(`setOutput ${request.stack}`)).pipe(
          Effect.andThen(inner.setOutput(request))
        ),
    };

    return { outputs, state, store, writes } satisfies Recorded;
  });

const snapshot = (recorded: Recorded) =>
  JSON.stringify({ outputs: recorded.outputs, state: recorded.state });

const stageKeys = (contents: Contents, stacks: readonly string[]) =>
  stacks.flatMap((stack) =>
    Object.entries(contents[stack] ?? {})
      .filter(([, stage]) => stage.fqns.length > 0 || stage.output)
      .map(([stage, { fqns, output }]) => ({
        fqns: [...new Set(fqns)].toSorted(),
        output,
        stack,
        stage,
      }))
  );

const pick = (contents: Contents, picks: readonly boolean[]) => {
  const stacks = Object.keys(contents).toSorted();

  return stacks.filter(
    (_stack, index) => index === 0 || (picks[index % picks.length] ?? false)
  );
};

const transientFailuresPerWrite = 2;

const flakyStore = (store: StateService, flips: readonly boolean[]) => {
  const watch = {
    calls: 0,
    failed: new Map<string, number>(),
    inFlight: 0,
    peak: 0,
  };

  const write = <A>(
    key: string,
    operation: Effect.Effect<A, StateStoreError>
  ) =>
    Effect.gen(function* flakyWrite() {
      watch.inFlight += 1;
      watch.peak = Math.max(watch.peak, watch.inFlight);
      yield* Effect.yieldNow;
      yield* Effect.yieldNow;

      const call = watch.calls;
      watch.calls += 1;
      const failures = watch.failed.get(key) ?? 0;

      if (
        (flips[call % flips.length] ?? false) &&
        failures < transientFailuresPerWrite
      ) {
        watch.failed.set(key, failures + 1);

        return yield* new StateStoreError({ message: `transient ${key}` });
      }

      return yield* operation;
    }).pipe(
      Effect.ensuring(
        Effect.sync(() => {
          watch.inFlight -= 1;
        })
      )
    );

  const flaky: StateService = {
    ...store,
    set: (request) =>
      write(
        `set ${request.stack}/${request.stage}/${request.fqn}`,
        store.set(request)
      ),
    setOutput: (request) =>
      write(
        `setOutput ${request.stack}/${request.stage}`,
        store.setOutput(request)
      ),
  };

  return { store: flaky, watch };
};

const withAdvancingClock = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* advanceUntilDone() {
    const fiber = yield* Effect.forkChild(effect);

    while (fiber.pollUnsafe() === undefined) {
      yield* TestClock.adjust("1 minute");
      yield* Effect.yieldNow;
    }

    return yield* Fiber.join(fiber);
  });

const NonEmptyEntries = StoreEntries.check(Schema.isMinLength(1));

const Picks = Schema.Array(Schema.Boolean).check(Schema.isMinLength(1));

it.effect.prop(
  "a dry run writes to neither store and counts every allowlisted stage",
  { entries: NonEmptyEntries, picks: Picks },
  ({ entries, picks }) =>
    Effect.gen(function* dryRunWritesNothing() {
      const contents = contentsOf(entries);
      const source = yield* recordedStore(contents);
      const destination = yield* recordedStore({});
      const stacks = pick(contents, picks);
      const before = snapshot(source);

      const report = yield* copyStacks(
        { destination: destination.store, source: source.store },
        { dryRun: true, from: "a", stacks, to: "b" }
      );

      expect(source.writes).toEqual([]);
      expect(destination.writes).toEqual([]);
      expect(snapshot(source)).toBe(before);
      expect(report.mode).toBe("dry-run");

      expect(report.source.reduce((total, row) => total + row.records, 0)).toBe(
        stageKeys(contents, stacks).reduce(
          (total, row) => total + row.fqns.length,
          0
        )
      );
    })
);

it.effect.prop(
  "a copy mirrors exactly the allowlisted stacks, leaves the source untouched, and deletes nothing",
  { bystanders: StoreEntries, entries: NonEmptyEntries, picks: Picks },
  ({ bystanders, entries, picks }) =>
    Effect.gen(function* copyMirrorsAllowlist() {
      const contents = contentsOf(entries);
      const stacks = pick(contents, picks);

      const unrelated = Object.fromEntries(
        Object.entries(contentsOf(bystanders)).filter(
          ([stack]) => !stacks.includes(stack)
        )
      );

      const source = yield* recordedStore(contents);
      const destination = yield* recordedStore(unrelated);
      const sourceBefore = snapshot(source);

      const report = yield* copyStacks(
        { destination: destination.store, source: source.store },
        { dryRun: false, from: "a", stacks, to: "b" }
      );

      expect(report.fqnSetsEqual).toBe(true);
      expect(source.writes).toEqual([]);
      expect(snapshot(source)).toBe(sourceBefore);

      expect(
        destination.writes.filter((write) => write.startsWith("delete"))
      ).toEqual([]);

      for (const write of destination.writes) {
        expect(stacks).toContain(write.split(" ")[1]);
      }

      for (const { fqns, output, stack, stage } of stageKeys(
        contents,
        stacks
      )) {
        expect(
          Object.keys(destination.state[stack]?.[stage] ?? {}).toSorted()
        ).toEqual(fqns);
        expect(destination.outputs[stack]?.[stage] !== undefined).toBe(output);
      }

      for (const stack of Object.keys(unrelated)) {
        expect(destination.state[stack]).toEqual(
          (yield* recordedStore(unrelated)).state[stack]
        );
      }
    })
);

it.effect.prop(
  "a copy through a destination that drops writes transiently still ends with identical FQN sets",
  { entries: NonEmptyEntries, flips: Picks, picks: Picks },
  ({ entries, flips, picks }) =>
    Effect.gen(function* copySurvivesTransientFailures() {
      const contents = contentsOf(entries);
      const stacks = pick(contents, picks);
      const source = yield* recordedStore(contents);
      const destination = yield* recordedStore({});
      const flaky = flakyStore(destination.store, flips);

      const report = yield* withAdvancingClock(
        copyStacks(
          { destination: flaky.store, source: source.store },
          { dryRun: false, from: "a", stacks, to: "b" }
        )
      );

      expect(report.fqnSetsEqual).toBe(true);

      for (const { fqns, output, stack, stage } of stageKeys(
        contents,
        stacks
      )) {
        expect(
          Object.keys(destination.state[stack]?.[stage] ?? {}).toSorted()
        ).toEqual(fqns);
        expect(destination.outputs[stack]?.[stage] !== undefined).toBe(output);
      }
    })
);

it.effect.prop(
  "a copy never has more destination writes in flight than the bound",
  { entries: NonEmptyEntries, flips: Picks, picks: Picks },
  ({ entries, flips, picks }) =>
    Effect.gen(function* copyBoundsWrites() {
      const contents = contentsOf(entries);
      const stacks = pick(contents, picks);
      const source = yield* recordedStore(contents);
      const destination = yield* recordedStore({});
      const flaky = flakyStore(destination.store, flips);

      yield* withAdvancingClock(
        copyStacks(
          { destination: flaky.store, source: source.store },
          { dryRun: false, from: "a", stacks, to: "b" }
        )
      );

      expect(flaky.watch.peak).toBeLessThanOrEqual(maxWritesInFlight);
    })
);

it.effect.prop(
  "a destination that already holds a listed stack is refused before any write",
  { entries: NonEmptyEntries, picks: Picks },
  ({ entries, picks }) =>
    Effect.gen(function* refusesHeldDestination() {
      const contents = contentsOf(entries);
      const stacks = pick(contents, picks);
      const [held = ""] = stacks;
      const source = yield* recordedStore(contents);
      const destination = yield* recordedStore({ [held]: {} });

      const result = yield* copyStacks(
        { destination: destination.store, source: source.store },
        { dryRun: false, from: "a", stacks, to: "b" }
      ).pipe(Effect.result);

      expect(Result.isFailure(result) && result.failure.reason).toBe(
        "destination-holds-stack"
      );
      expect(source.writes).toEqual([]);
      expect(destination.writes).toEqual([]);
    })
);

it.effect.prop(
  "an allowlist with no stack names is refused before any store is read or written",
  {
    entries: StoreEntries,
    list: Schema.String.check(Schema.isPattern(/^[\s,]*$/u)),
  },
  ({ entries, list }) =>
    Effect.gen(function* refusesEmptyAllowlist() {
      const source = yield* recordedStore(contentsOf(entries));
      const destination = yield* recordedStore({});

      const result = yield* copyStacks(
        { destination: destination.store, source: source.store },
        { dryRun: false, from: "a", stacks: parseStackList(list), to: "b" }
      ).pipe(Effect.result);

      expect(Result.isFailure(result) && result.failure.reason).toBe(
        "empty-allowlist"
      );
      expect(source.writes).toEqual([]);
      expect(destination.writes).toEqual([]);
    })
);
