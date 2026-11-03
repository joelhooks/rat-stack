import { expect, it } from "@effect/vitest";
import { InMemoryService } from "alchemy/State/InMemoryState";
import type { ResourceState } from "alchemy/State/ResourceState";
import type { StateService } from "alchemy/State/State";
import { Effect, Result, Schema } from "effect";

import { copyStacks, parseStackList } from "../src/state-copy.js";

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
