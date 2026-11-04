import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import {
  FlagChangesPage,
  FlagFlipRefused,
  FlagPosition,
  FlagPreviousValue,
  FlagTarget,
  flagPartition,
} from "@rat-stack/core/flag-control";
import { FlagStorageError } from "@rat-stack/core/flags";
import { flagValueKey } from "@rat-stack/flags/kv";
import { Effect, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import type { HttpClient } from "effect/http";

import {
  deployFlagLedger,
  eventually,
  failed,
  localServices,
  position,
  receipt,
  succeeded,
  tenantScope,
} from "./fixtures/flag-ledger-client.js";
import type { FlagLedgerClient } from "./fixtures/flag-ledger-client.js";
import {
  LedgerOutcome,
  deployFlag,
  ladderFlag,
  ladderRungs,
} from "./fixtures/flag-ledger-protocol.js";
import { durableObjectStorage, kvStorage } from "./fixtures/local-storage.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `flag_ledger_runtime_${process.pid}`,
});

const decodePosition = (text: string) =>
  Schema.decodeEffect(Schema.fromJsonString(FlagPosition))(text).pipe(
    Effect.orDie
  );

const Step = Schema.TaggedUnion({
  Evidence: {
    faulted: Schema.Boolean,
    ref: Schema.Literals(["first", "second"]),
    rung: Schema.Literals(ladderRungs),
  },
  Flip: {
    faulted: Schema.Boolean,
    target: Schema.Literals(["kill", ...ladderRungs]),
  },
});

interface Ladder {
  readonly at: number;
  readonly revision: number;
  readonly ref: Option.Option<string>;
  readonly receipt: Option.Option<{
    readonly evidenceRefs: readonly string[];
    readonly from: string;
    readonly reason: string;
    readonly revision: number;
    readonly to: string;
  }>;
}

type Expectation =
  | { readonly kind: "accepted"; readonly next: Ladder }
  | { readonly kind: "refused"; readonly reason: FlagFlipRefused["reason"] }
  | { readonly kind: "storage" };

const accepted = (next: Ladder): Expectation => ({ kind: "accepted", next });

const refused = (reason: FlagFlipRefused["reason"]): Expectation => ({
  kind: "refused",
  reason,
});

const storageFailure: Expectation = { kind: "storage" };

const rungAt = (at: number) => ladderRungs[at] ?? ladderRungs[0];

const reasonFor = (target: string) => `flip ${target}`;

const climb = (
  ladder: Ladder,
  target: string,
  next: number,
  evidenceRefs: readonly string[]
): Ladder => ({
  at: next,
  receipt: Option.some({
    evidenceRefs,
    from: rungAt(ladder.at),
    reason: reasonFor(target),
    revision: ladder.revision + 1,
    to: rungAt(next),
  }),
  ref: Option.none(),
  revision: ladder.revision + 1,
});

const expectationOf = (ladder: Ladder, step: typeof Step.Type): Expectation =>
  Step.match(step, {
    Evidence: ({ ref, rung }) =>
      rung === rungAt(ladder.at) && ladder.at < ladderRungs.length - 1
        ? accepted({ ...ladder, ref: Option.some(ref) })
        : refused("evidence-required"),
    Flip: ({ faulted, target }) => {
      if (target === "kill") {
        return faulted
          ? storageFailure
          : accepted(climb(ladder, target, Math.max(0, ladder.at - 1), []));
      }

      if (ladderRungs.indexOf(target) !== ladder.at + 1) {
        return refused("not-next-rung");
      }

      return Option.match(ladder.ref, {
        onNone: () => refused("evidence-required"),
        onSome: (ref) =>
          faulted
            ? storageFailure
            : accepted(climb(ladder, target, ladder.at + 1, [ref])),
      });
    },
  });

const initial: Ladder = {
  at: 0,
  receipt: Option.none(),
  ref: Option.none(),
  revision: 0,
};

const seedEvidence = Step.cases.Evidence.make({
  faulted: false,
  ref: "first",
  rung: "off",
});

const seed = [
  seedEvidence,
  Step.cases.Flip.make({ faulted: false, target: "canary" }),
  Step.cases.Flip.make({ faulted: false, target: "kill" }),
];

const send = (
  client: FlagLedgerClient,
  scope: { readonly tenant: string },
  step: typeof Step.Type
) =>
  Step.match(step, {
    Evidence: ({ ref, rung }) =>
      client.evidence({
        event: "check",
        name: ladderFlag.name,
        observed: 1,
        read: "acceptance report",
        ref,
        rung,
        scope,
      }),
    Flip: ({ target }) =>
      client.flip(
        {
          authority: "agent",
          name: ladderFlag.name,
          reason: reasonFor(target),
          scope,
          target:
            target === "kill"
              ? FlagTarget.cases.off.make({})
              : FlagTarget.cases.rung.make({ name: target }),
        },
        "model"
      ),
  });

const expectPosition = (
  observed: typeof FlagPosition.Type,
  ladder: Ladder,
  scope: { readonly tenant: string }
) => {
  expect(observed).toMatchObject({
    revision: ladder.revision,
    rung: rungAt(ladder.at),
    value: rungAt(ladder.at),
  });
  expect(observed.evidence.map((record) => record.ref)).toStrictEqual(
    Option.toArray(ladder.ref)
  );
  expect(Option.fromUndefinedOr(observed.receipt)).toStrictEqual(
    ladder.receipt.pipe(
      Option.map((expected) => ({
        actor: "model",
        approvalRef: null,
        authority: "agent",
        evidenceRefs: [...expected.evidenceRefs],
        from: expected.from,
        name: ladderFlag.name,
        reason: expected.reason,
        revision: expected.revision,
        scope,
        to: expected.to,
        value: expected.to,
      }))
    )
  );
};

type LocalLedger = Effect.Success<ReturnType<typeof durableObjectStorage>>;

const quiesce = (storage: LocalLedger) =>
  eventually(
    Effect.all([storage.keys("dirty/"), storage.alarmPending]),
    ([dirty, alarm]) => dirty.length === 0 && !alarm
  );

const checkOutcome = (
  outcome: Effect.Success<ReturnType<FlagLedgerClient["read"]>>,
  expectation: Expectation,
  step: typeof Step.Type
) =>
  Effect.gen(function* checkStepOutcome() {
    if (expectation.kind === "accepted") {
      const revision = yield* Step.match(step, {
        Evidence: () =>
          succeeded(Schema.Null)(outcome).pipe(
            Effect.as(expectation.next.revision)
          ),
        Flip: () =>
          receipt(outcome).pipe(Effect.map((committed) => committed.revision)),
      });

      expect(revision).toBe(expectation.next.revision);

      return;
    }

    const error = yield* failed(outcome);

    if (expectation.kind === "refused") {
      expect(Schema.is(FlagFlipRefused)(error)).toBe(true);
      expect(error).toMatchObject({ reason: expectation.reason });

      return;
    }

    expect(Schema.is(FlagStorageError)(error)).toBe(true);
    expect(error).toMatchObject({ flag: ladderFlag.name, operation: "write" });
  });

const step =
  (
    client: FlagLedgerClient,
    storage: LocalLedger,
    scope: { readonly tenant: string }
  ) =>
  (ladder: Ladder, next: typeof Step.Type) =>
    Effect.gen(function* checkLedgerStep() {
      const partition = flagPartition(ladderFlag.name, scope);
      const expectation = expectationOf(ladder, next);

      const outcome = yield* Effect.gen(function* performStep() {
        if (next.faulted) {
          yield* quiesce(storage);
          yield* storage.rejectCommits;
        }

        return yield* send(client, scope, next);
      }).pipe(Effect.scoped);

      yield* checkOutcome(outcome, expectation, next);

      const after = expectation.kind === "accepted" ? expectation.next : ladder;

      const pending = yield* storage
        .read(`dirty/${partition}`)
        .pipe(
          Effect.flatMap((marker) =>
            Effect.forEach(Option.toArray(marker), decodePosition)
          )
        );

      expect(pending.every((entry) => entry.revision <= after.revision)).toBe(
        true
      );

      expectPosition(
        yield* position(yield* client.read(ladderFlag.name, scope)),
        after,
        scope
      );

      const persisted = yield* storage
        .read(`state/${partition}`)
        .pipe(
          Effect.flatMap(Effect.fromOption),
          Effect.orDie,
          Effect.flatMap(decodePosition)
        );

      expectPosition(persisted, after, scope);

      return after;
    });

const runHistory = (
  client: FlagLedgerClient,
  steps: readonly (typeof Step.Type)[]
) =>
  Effect.gen(function* checkLedgerHistory() {
    const scope = yield* tenantScope;
    const partition = flagPartition(ladderFlag.name, scope);

    yield* send(client, scope, seedEvidence).pipe(
      Effect.flatMap(succeeded(Schema.Null))
    );

    const storage = yield* durableObjectStorage(
      "FlagLedger",
      `state/${partition}`
    );

    const final = yield* Effect.reduce(
      [...seed.slice(1), ...steps],
      () => ({ ...initial, ref: Option.some("first") }),
      step(client, storage, scope)
    );

    yield* eventually(
      Effect.all([
        client.kvGet(flagValueKey(ladderFlag.name, scope)),
        storage.keys("dirty/"),
      ]),
      ([replica, dirty]) =>
        replica === JSON.stringify(rungAt(final.at)) && dirty.length === 0
    );

    return true;
  }).pipe(Effect.scoped, Effect.orDie);

test.provider(
  "committed positions follow an independent ladder model, and failed commits never manufacture receipts",
  (stack) =>
    Effect.gen(function* checkDurableCommits() {
      const client = yield* deployFlagLedger(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.array(Arbitrary.schema(Step), { maxLength: 10 }),
        (steps) => runHistory(client, steps),
        { maxShrinks: 20, runs: 15 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

test.provider(
  "a corrupt authoritative position fails reads and writes with its partition and is never overwritten",
  (stack) =>
    Effect.gen(function* checkCorruptPosition() {
      const client = yield* deployFlagLedger(stack);
      const scope = yield* tenantScope;
      const partition = flagPartition(ladderFlag.name, scope);

      yield* send(client, scope, seedEvidence);

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `state/${partition}`
      );

      yield* storage.write(`state/${partition}`, "not a position");

      const attempts = [
        yield* client.read(ladderFlag.name, scope),
        yield* send(
          client,
          scope,
          Step.cases.Flip.make({ faulted: false, target: "canary" })
        ),
        yield* send(
          client,
          scope,
          Step.cases.Evidence.make({
            faulted: false,
            ref: "second",
            rung: "off",
          })
        ),
      ];

      for (const outcome of attempts) {
        const error = yield* failed(outcome);

        expect(Schema.is(FlagStorageError)(error)).toBe(true);
        expect(error).toMatchObject({
          flag: partition,
          operation: "read",
          repair: "Repair the authoritative ledger position before retrying.",
        });
      }

      expect(yield* storage.read(`state/${partition}`)).toStrictEqual(
        Option.some("not a position")
      );
      expect(yield* storage.keys("dirty/")).toStrictEqual([]);
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

test.provider(
  "deployment-only flags refuse evidence and kills without advancing their position",
  (stack) =>
    Effect.gen(function* checkDeploymentOnly() {
      const client = yield* deployFlagLedger(stack);

      const attempts = [
        yield* client.evidence({
          event: "check",
          name: deployFlag.name,
          observed: 1,
          read: "acceptance report",
          ref: "deploy",
          rung: "off",
        }),
        yield* client.flip({
          authority: "agent",
          name: deployFlag.name,
          reason: "deploy",
          target: FlagTarget.cases.off.make({}),
        }),
      ];

      for (const outcome of attempts) {
        const error = yield* failed(outcome);

        expect(Schema.is(FlagStorageError)(error)).toBe(true);
        expect(error).toMatchObject({
          flag: deployFlag.name,
          operation: "write",
          repair:
            "Change deployment Config and review the infrastructure plan.",
        });
      }

      expect(
        yield* position(yield* client.read(deployFlag.name))
      ).toStrictEqual({
        evidence: [],
        revision: 0,
        rung: "off",
        value: false,
      });
    }),
  { timeout: 120_000 }
);

const committedMarker = (scope: { readonly tenant: string }) =>
  JSON.stringify({
    evidence: [],
    receipt: {
      actor: "seed",
      approvalRef: null,
      authority: "agent",
      evidenceRefs: [],
      from: "off",
      name: ladderFlag.name,
      reason: "seed",
      revision: 1,
      scope,
      to: "canary",
      value: "canary",
    },
    revision: 1,
    rung: "canary",
    value: "canary",
  });

const climbOnce = (
  client: FlagLedgerClient,
  scope: { readonly tenant: string }
) =>
  send(
    client,
    scope,
    Step.cases.Flip.make({ faulted: false, target: "canary" })
  ).pipe(Effect.flatMap(receipt));

test.provider(
  "a replica failure keeps the committed receipt pending, and redrive converges once KV recovers",
  (stack) =>
    Effect.gen(function* checkReplicaRecovery() {
      const client = yield* deployFlagLedger(stack);
      const scope = yield* tenantScope;
      const partition = flagPartition(ladderFlag.name, scope);
      const valueKey = flagValueKey(ladderFlag.name, scope);

      yield* send(client, scope, seedEvidence);
      yield* client.kvPut(`sentinel/${scope.tenant}`, "present");

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `state/${partition}`
      );

      const replica = yield* kvStorage(`sentinel/${scope.tenant}`);

      yield* Effect.gen(function* failReplicaWrites() {
        yield* replica.rejectWrites;

        const committed = yield* climbOnce(client, scope);

        expect(committed.revision).toBe(1);

        const retry = yield* client.redrive(partition);

        expect(LedgerOutcome.guards.Success(retry)).toBe(false);

        const marker = yield* storage
          .read(`dirty/${partition}`)
          .pipe(
            Effect.flatMap(Effect.fromOption),
            Effect.orDie,
            Effect.flatMap(decodePosition)
          );

        expect(marker.receipt).toStrictEqual(committed);
        expect(yield* client.kvGet(valueKey)).toBeNull();

        expect(
          (yield* position(yield* client.read(ladderFlag.name, scope))).receipt
        ).toStrictEqual(committed);
      }).pipe(Effect.scoped);

      for (const attempt of [1, 2]) {
        yield* succeeded(Schema.Null)(yield* client.redrive(partition));
        expect([attempt, yield* client.kvGet(valueKey)]).toStrictEqual([
          attempt,
          JSON.stringify("canary"),
        ]);
        expect(yield* storage.keys("dirty/")).toStrictEqual([]);
      }
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

test.provider(
  "a full page of pending markers re-arms the alarm until every marker projects",
  (stack) =>
    Effect.gen(function* checkFullPage() {
      const client = yield* deployFlagLedger(stack);
      const owner = yield* tenantScope;
      const partition = flagPartition(ladderFlag.name, owner);

      yield* send(client, owner, seedEvidence);

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `state/${partition}`
      );

      const scopes = [...Array.from({ length: 150 }).keys()].map((index) => ({
        tenant: `${owner.tenant}-${String(index).padStart(3, "0")}`,
      }));

      yield* Effect.forEach((scope: { readonly tenant: string }) =>
        storage.write(
          `dirty/${flagPartition(ladderFlag.name, scope)}`,
          committedMarker(scope)
        )
      )(scopes);

      yield* succeeded(Schema.Null)(yield* client.redrive(partition));

      yield* eventually(storage.keys("dirty/"), (dirty) => dirty.length === 0);

      const replicas = yield* Effect.forEach(
        (scope: { readonly tenant: string }) =>
          client.kvGet(flagValueKey(ladderFlag.name, scope))
      )(scopes);

      expect(new Set(replicas)).toStrictEqual(
        new Set([JSON.stringify("canary")])
      );
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

const Climb = Schema.Struct({
  redrives: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
  target: Schema.Literals(["kill", "next"]),
});

test.provider(
  "concurrent redrives never let an older projection clear a newer commit",
  (stack) =>
    Effect.gen(function* checkProjectionRaces() {
      const client = yield* deployFlagLedger(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.array(Arbitrary.schema(Climb), {
          maxLength: 8,
          minLength: 1,
        }),
        (climbs) =>
          Effect.gen(function* raceProjections() {
            const scope = yield* tenantScope;
            const partition = flagPartition(ladderFlag.name, scope);

            const final = yield* Effect.reduce(
              climbs,
              () => 0,
              (at, next) =>
                Effect.gen(function* climbAndRedrive() {
                  const climbing =
                    next.target === "next" && at < ladderRungs.length - 1;

                  if (climbing) {
                    yield* send(
                      client,
                      scope,
                      Step.cases.Evidence.make({
                        faulted: false,
                        ref: "first",
                        rung: rungAt(at),
                      })
                    );
                  }

                  const target = climbing ? rungAt(at + 1) : "kill";

                  yield* Effect.all(
                    [
                      send(
                        client,
                        scope,
                        Step.cases.Flip.make({ faulted: false, target })
                      ).pipe(Effect.flatMap(receipt)),
                      ...Array.from({ length: next.redrives }, () =>
                        client.redrive(partition)
                      ),
                    ],
                    { concurrency: "unbounded" }
                  );

                  return climbing ? at + 1 : Math.max(0, at - 1);
                })
            );

            const storage = yield* durableObjectStorage(
              "FlagLedger",
              `state/${partition}`
            );

            yield* eventually(
              Effect.all([
                client.kvGet(flagValueKey(ladderFlag.name, scope)),
                storage.keys("dirty/"),
              ]),
              ([replica, dirty]) =>
                replica === JSON.stringify(rungAt(final)) && dirty.length === 0
            );

            return true;
          }).pipe(Effect.scoped, Effect.orDie),
        { maxShrinks: 10, runs: 10 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

const Outcome = Schema.Literals([
  "Pending",
  "Succeeded",
  "Denied",
  "Failed",
  "Interrupted",
]);

const attempt = (
  scope: { readonly tenant: string },
  index: number,
  outcome: typeof Outcome.Type
) => ({
  actor: "journal",
  attemptId: `${scope.tenant}-${String(index).padStart(3, "0")}`,
  name: ladderFlag.name,
  newValue: index,
  oldValue: FlagPreviousValue.cases.Known.make({ value: index - 1 }),
  outcome,
  recordedAt: 1000 + index,
  scope,
});

const recordAll = (
  client: FlagLedgerClient,
  scope: { readonly tenant: string },
  outcomes: readonly (typeof Outcome.Type)[]
) =>
  Effect.forEach((outcome: typeof Outcome.Type, index: number) =>
    Effect.gen(function* recordAttempt() {
      yield* succeeded(Schema.Null)(
        yield* client.record(attempt(scope, index, "Pending"))
      );

      if (outcome !== "Pending") {
        yield* succeeded(Schema.Null)(
          yield* client.record(attempt(scope, index, outcome))
        );
      }
    })
  )(outcomes);

const readPages = (
  client: FlagLedgerClient,
  scope: { readonly tenant: string },
  limit: number,
  bound: number
) => {
  const next = (
    cursor: string | undefined,
    pages: readonly (typeof FlagChangesPage.Type)[]
  ): Effect.Effect<
    readonly (typeof FlagChangesPage.Type)[],
    never,
    HttpClient.HttpClient
  > =>
    pages.length > bound
      ? Effect.die(`More than ${bound} pages for one journal`)
      : client.list({ cursor, limit, name: ladderFlag.name, scope }).pipe(
          Effect.flatMap(succeeded(FlagChangesPage)),
          Effect.orDie,
          Effect.flatMap((page) =>
            page.cursor === undefined
              ? Effect.succeed([...pages, page])
              : next(page.cursor, [...pages, page])
          )
        );

  return next(undefined, []);
};

test.provider(
  "journal pages resume without loss or duplication and keep each attempt's own outcome",
  (stack) =>
    Effect.gen(function* checkJournalPages() {
      const client = yield* deployFlagLedger(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.all({
          limit: Arbitrary.schema(
            Schema.Int.check(Schema.isBetween({ maximum: 8, minimum: 1 }))
          ),
          outcomes: Arbitrary.array(Arbitrary.schema(Outcome), {
            maxLength: 25,
          }),
        }),
        ({ limit, outcomes }) =>
          Effect.gen(function* checkPages() {
            const scope = yield* tenantScope;

            yield* recordAll(client, scope, outcomes);

            const bound = Math.floor(outcomes.length / limit) + 1;
            const pages = yield* readPages(client, scope, limit, bound);
            const changes = pages.flatMap((page) => page.changes);

            expect(pages.length).toBeLessThanOrEqual(bound);
            expect(pages.every((page) => page.changes.length <= limit)).toBe(
              true
            );
            expect(
              changes.map(({ ageMillis: _age, ...change }) => change)
            ).toStrictEqual(
              outcomes.map((outcome, index) => attempt(scope, index, outcome))
            );

            return true;
          }),
        { maxShrinks: 20, runs: 20 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

test.provider(
  "a mismatched completion or a corrupt attempt fails its journal page instead of being skipped",
  (stack) =>
    Effect.gen(function* checkJournalIntegrity() {
      const client = yield* deployFlagLedger(stack);
      const mismatched = yield* tenantScope;
      const corrupt = yield* tenantScope;

      yield* recordAll(client, mismatched, ["Pending", "Pending"]);
      yield* client.record({
        ...attempt(mismatched, 0, "Succeeded"),
        newValue: "other",
      });

      yield* recordAll(client, corrupt, ["Pending", "Pending"]);

      const broken = attempt(corrupt, 1, "Pending").attemptId;

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `attempts/${broken}`
      );

      yield* storage.write(`attempts/${broken}`, "not an attempt");

      for (const [scope, key] of [
        [mismatched, `attempts/${attempt(mismatched, 0, "Pending").attemptId}`],
        [corrupt, `attempts/${broken}`],
      ] as const) {
        const error = yield* failed(
          yield* client.list({ limit: 10, name: ladderFlag.name, scope })
        );

        expect(Schema.is(FlagStorageError)(error)).toBe(true);
        expect(error).toMatchObject({
          flag: key,
          operation: "listChanges",
          repair:
            "Restore or repair this journal entry, then retry the same cursor.",
        });
      }
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

test.provider(
  "a failed completion write leaves its attempt pending",
  (stack) =>
    Effect.gen(function* checkFailedCompletion() {
      const client = yield* deployFlagLedger(stack);
      const scope = yield* tenantScope;
      const pending = attempt(scope, 0, "Pending");

      yield* recordAll(client, scope, ["Pending"]);

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `attempts/${pending.attemptId}`
      );

      const completion = yield* Effect.gen(function* failCompletion() {
        yield* storage.rejectWrites;

        return yield* client.record(attempt(scope, 0, "Succeeded"));
      }).pipe(Effect.scoped);

      const error = yield* failed(completion);

      expect(Schema.is(FlagStorageError)(error)).toBe(true);
      expect(error).toMatchObject({
        flag: ladderFlag.name,
        operation: "audit",
      });

      const page = yield* succeeded(FlagChangesPage)(
        yield* client.list({ limit: 10, name: ladderFlag.name, scope })
      );

      expect(
        page.changes.map(({ ageMillis: _age, ...change }) => change)
      ).toStrictEqual([pending]);
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);
