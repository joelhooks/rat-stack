import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import {
  FlagChangesPage,
  FlagFlipRefused,
  FlagPreviousValue,
  FlagScopeMismatch,
  FlagTarget,
  flagPartition,
} from "@rat-stack/core/flag-control";
import { FlagStorageError, UnknownFlag } from "@rat-stack/core/flags";
import { Effect, Match, Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  deployFlagLedger,
  failed,
  localServices,
  position,
  succeeded,
  tenantScope,
} from "./fixtures/flag-ledger-client.js";
import type { FlagLedgerClient } from "./fixtures/flag-ledger-client.js";
import { deployFlag, ladderFlag } from "./fixtures/flag-ledger-protocol.js";
import { durableObjectStorage } from "./fixtures/local-storage.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `flag_control_runtime_${process.pid}`,
});

const Operation = Schema.Literals([
  "flip",
  "read",
  "recordEvidence",
  "list",
  "record",
]);

const ScopeChoice = Schema.Literals(["omitted", "global", "tenant"]);

const withScope = <A extends { readonly name: string }>(
  base: A,
  scope?: Schema.Json
) => (scope === undefined ? base : { ...base, scope });

const kill = (scope?: Schema.Json) =>
  withScope(
    {
      authority: "agent" as const,
      name: ladderFlag.name,
      reason: "route",
      target: FlagTarget.cases.off.make({}),
    },
    scope
  );

const evidence = (ref: string, scope?: Schema.Json) =>
  withScope(
    {
      event: "check",
      name: ladderFlag.name,
      observed: 1,
      read: "acceptance report",
      ref,
      rung: "off",
    },
    scope
  );

const change = (attemptId: string, scope?: Schema.Json) =>
  withScope(
    {
      actor: "router",
      attemptId,
      name: ladderFlag.name,
      newValue: attemptId,
      oldValue: FlagPreviousValue.cases.Unavailable.make({ reason: "routing" }),
      outcome: "Pending" as const,
      recordedAt: 1,
    },
    scope
  );

const observe = (
  client: FlagLedgerClient,
  partition: string,
  scope: Schema.Json
) =>
  Effect.all({
    changes: client
      .directList(partition, { limit: 100, name: ladderFlag.name, scope })
      .pipe(
        Effect.flatMap(succeeded(FlagChangesPage)),
        Effect.map((page) => page.changes.map((entry) => entry.attemptId))
      ),
    position: client
      .directRead(partition, ladderFlag.name, scope)
      .pipe(Effect.flatMap(position)),
  }).pipe(Effect.orDie);

test.provider(
  "each operation reaches its own name and scope partition, and an omitted scope is the global partition",
  (stack) =>
    Effect.gen(function* checkPartitionRouting() {
      const client = yield* deployFlagLedger(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.all({
          choice: Arbitrary.schema(ScopeChoice),
          operation: Arbitrary.schema(Operation),
        }),
        ({ choice, operation }) =>
          Effect.gen(function* checkRoute() {
            const tenant = yield* tenantScope;
            const decoy = yield* tenantScope;

            const chosen = Match.value(choice).pipe(
              Match.when("omitted", () => Option.none<Schema.Json>()),
              Match.when("global", () => Option.some<Schema.Json>("global")),
              Match.orElse(() => Option.some<Schema.Json>(tenant))
            );

            const sent = Option.getOrUndefined(chosen);
            const scope = Option.getOrElse(chosen, () => "global");
            const target = flagPartition(ladderFlag.name, scope);
            const elsewhere = flagPartition(ladderFlag.name, decoy);

            const before = yield* observe(client, target, scope);
            const untouched = yield* observe(client, elsewhere, scope);

            const outcome = yield* Match.value(operation).pipe(
              Match.when("flip", () => client.flip(kill(sent), "router")),
              Match.when("read", () => client.read(ladderFlag.name, sent)),
              Match.when("recordEvidence", () =>
                client.evidence(evidence(tenant.tenant, sent))
              ),
              Match.when("list", () =>
                client.list(
                  withScope({ limit: 100, name: ladderFlag.name }, sent)
                )
              ),
              Match.orElse(() => client.record(change(tenant.tenant, sent)))
            );

            const after = yield* observe(client, target, scope);

            expect(yield* observe(client, elsewhere, scope)).toStrictEqual(
              untouched
            );

            yield* Match.value(operation).pipe(
              Match.when("flip", () =>
                Effect.sync(() => {
                  expect(after.position.revision).toBe(
                    before.position.revision + 1
                  );
                  expect(after.position.receipt?.actor).toBe("router");
                })
              ),
              Match.when("read", () =>
                position(outcome).pipe(
                  Effect.flatMap((read) =>
                    Effect.sync(() => {
                      expect(read).toStrictEqual(after.position);
                    })
                  )
                )
              ),
              Match.when("recordEvidence", () =>
                Effect.sync(() => {
                  expect(
                    after.position.evidence.map((entry) => entry.ref)
                  ).toContain(tenant.tenant);
                })
              ),
              Match.when("list", () =>
                succeeded(FlagChangesPage)(outcome).pipe(
                  Effect.flatMap((page) =>
                    Effect.sync(() => {
                      expect(
                        page.changes.map((entry) => entry.attemptId)
                      ).toStrictEqual(after.changes);
                    })
                  )
                )
              ),
              Match.orElse(() =>
                Effect.sync(() => {
                  expect(after.changes).toContain(tenant.tenant);
                })
              )
            );

            return true;
          }).pipe(Effect.orDie),
        { maxShrinks: 10, runs: 30 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

const corruptPartition = (client: FlagLedgerClient) =>
  Effect.gen(function* corruptOnePartition() {
    const scope = yield* tenantScope;
    const partition = flagPartition(ladderFlag.name, scope);

    yield* client.evidence(evidence("seed", scope));

    const storage = yield* durableObjectStorage(
      "FlagLedger",
      `state/${partition}`
    );

    yield* storage.write(`state/${partition}`, "not a position");

    return { partition, scope };
  });

test.provider(
  "every declared failure the object raises reaches the operator with its own tag, flag, repair, and message",
  (stack) =>
    Effect.gen(function* checkFailureFidelity() {
      const client = yield* deployFlagLedger(stack);
      const corrupt = yield* corruptPartition(client);

      const corruptRead = new FlagStorageError({
        cause: "remote",
        fallback: null,
        flag: corrupt.partition,
        operation: "read",
        repair: "Repair the authoritative ledger position before retrying.",
      });

      const deploymentOnly = new FlagStorageError({
        cause: "remote",
        fallback: null,
        flag: deployFlag.name,
        operation: "write",
        repair: "Change deployment Config and review the infrastructure plan.",
      });

      const unknown = new UnknownFlag({
        flag: "LEDGER_MISSING",
        repair: "Choose a name returned by listFlags.",
      });

      const mismatch = new FlagScopeMismatch({
        flag: ladderFlag.name,
        repair: `Supply an exact scope accepted by ${ladderFlag.name}'s declared readScope schema. Evidence and flips must use that same scope.`,
        scope: { region: "nowhere" },
      });

      const cases = [
        [client.read(ladderFlag.name, corrupt.scope), corruptRead],
        [client.flip(kill(corrupt.scope)), corruptRead],
        [client.evidence(evidence("corrupt", corrupt.scope)), corruptRead],
        [client.flip({ ...kill(), name: deployFlag.name }), deploymentOnly],
        [
          client.evidence({
            ...evidence("deploy"),
            name: deployFlag.name,
          }),
          deploymentOnly,
        ],
        [client.read("LEDGER_MISSING"), unknown],
        [
          client.evidence({
            ...evidence("missing"),
            name: "LEDGER_MISSING",
          }),
          unknown,
        ],
        [
          client.evidence({ ...evidence("late"), rung: "on" }),
          new FlagFlipRefused({
            flag: ladderFlag.name,
            reason: "evidence-required",
            repair:
              "Measure a declared exit event at the current rung, using its declared read location and exact scope.",
          }),
        ],
        [client.flip({ ...kill(), name: "LEDGER_MISSING" }), unknown],
        [client.read(ladderFlag.name, { region: "nowhere" }), mismatch],
        [
          client.flip(
            {
              ...kill(),
              target: FlagTarget.cases.rung.make({ name: "on" }),
            },
            "router"
          ),
          new FlagFlipRefused({
            flag: ladderFlag.name,
            reason: "not-next-rung",
            repair: "Climb exactly one rung. To step down, flip off first.",
          }),
        ],
      ] as const;

      for (const [call, raised] of cases) {
        const error = yield* failed(yield* call);

        expect(error).toMatchObject({
          _tag: raised._tag,
          flag: raised.flag,
          message: raised.message,
          repair: raised.repair,
        });
      }
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

const unreachable = (
  operation: FlagStorageError["operation"],
  outcome: Effect.Success<ReturnType<FlagLedgerClient["read"]>>
) =>
  failed(outcome).pipe(
    Effect.flatMap((refusal) =>
      Effect.sync(() => {
        expect(Schema.is(FlagStorageError)(refusal)).toBe(true);
        expect(refusal).toMatchObject({ flag: ladderFlag.name, operation });
        expect(refusal.repair).toContain("Durable Object connection");
      })
    )
  );

test.provider(
  "an unreachable object becomes a storage failure naming the flag and the operation",
  (stack) =>
    Effect.gen(function* checkTransportFailures() {
      const client = yield* deployFlagLedger(stack);
      const scope = yield* tenantScope;
      const partition = flagPartition(ladderFlag.name, scope);

      yield* succeeded(Schema.Unknown)(yield* client.flip(kill(scope)));

      const storage = yield* durableObjectStorage(
        "FlagLedger",
        `state/${partition}`
      );

      yield* Effect.gen(function* failWrites() {
        yield* storage.rejectWrites;

        yield* unreachable("write", yield* client.flip(kill(scope)));
        yield* unreachable(
          "write",
          yield* client.evidence(evidence("unreachable", scope))
        );
        yield* unreachable(
          "audit",
          yield* client.record(change(scope.tenant, scope))
        );
      }).pipe(Effect.scoped);

      yield* Effect.gen(function* failReads() {
        yield* storage.rejectReads;

        yield* unreachable("read", yield* client.read(ladderFlag.name, scope));
        yield* unreachable(
          "listChanges",
          yield* client.list({ limit: 10, name: ladderFlag.name, scope })
        );
      }).pipe(Effect.scoped);

      expect(
        (yield* position(yield* client.read(ladderFlag.name, scope))).revision
      ).toBe(1);
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);

test.provider(
  "a journal page without a flag name fails as listChanges and names no partition",
  (stack) =>
    Effect.gen(function* checkMissingPartition() {
      const client = yield* deployFlagLedger(stack);

      const error = yield* failed(yield* client.list({ limit: 10 }));

      expect(Schema.is(FlagStorageError)(error)).toBe(true);
      expect(error).toMatchObject({
        flag: "",
        operation: "listChanges",
        repair: "Supply the declared flag name and read scope.",
      });
    }),
  { timeout: 120_000 }
);
