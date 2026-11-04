import { NodeCrypto } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Approval } from "@rat-stack/capability/approval";
import {
  FlagJournal,
  FlagLedger,
  FlagTarget,
  flagPartition,
} from "@rat-stack/core/flag-control";
import { flipFeatureFlag } from "@rat-stack/core/flag-write-capabilities";
import {
  FlagStorageError,
  Flags,
  eventFlags,
  eventsEnabled,
  eventsIdentityMode,
  defineFlag,
} from "@rat-stack/core/flags";
import {
  ConfigProvider,
  Deferred,
  Effect,
  Fiber,
  Layer,
  Ref,
  Schema,
} from "effect";
import { TestClock } from "effect/testing";

import { configFlagsLayer } from "../src/config.js";
import { kvFlagControlLayer, kvFlagsLayer } from "../src/kv.js";
import { switchFlag, binaryLadder } from "./flag-fixture.js";
import { makeKVDouble } from "./kv-double.js";

const requiredFlag = defineFlag("REQUIRED_SWITCH", Schema.Boolean, {
  default: false,
  failurePolicy: "refuse",
  owner: "tests",
  purpose: "Exercise refused read fallbacks.",
  removeBy: "2099-01-01",
  rungs: binaryLadder(false, true),
});

it.effect.prop(
  "the declared refuse policy preserves missing, unavailable, and malformed replica failures",
  {
    mode: Schema.Literals(["missing", "unavailable", "malformed"]),
  },
  ({ mode }) =>
    Effect.gen(function* checkRefusalPolicy() {
      const double = yield* makeKVDouble;

      if (mode === "unavailable") {
        yield* Ref.set(double.failure, "read");
      }

      if (mode === "malformed") {
        yield* double.kv.put(`values/${requiredFlag.name}`, "invalid-json");
      }

      const flags = yield* Flags.pipe(
        Effect.provide(
          kvFlagsLayer([requiredFlag], double.kv).pipe(
            Layer.provide(Flags.defaults([requiredFlag]))
          )
        )
      );

      const error = yield* flags.get(requiredFlag, {}).pipe(Effect.flip);
      expect(error._tag).toBe(
        mode === "malformed" ? "InvalidFlagValue" : "FlagStorageError"
      );
      expect(error.repair.length).toBeGreaterThan(0);
    })
);

const prepareOn = FlagLedger.use((ledger) =>
  ledger.recordEvidence({
    event: "check",
    name: switchFlag.name,
    observed: 1,
    read: "acceptance report",
    ref: "test report",
    rung: "off",
  })
);

const flip = (value: boolean) =>
  flipFeatureFlag.handler({
    authority: "agent",
    name: switchFlag.name,
    reason: "test",
    target: value
      ? FlagTarget.cases.rung.make({ name: "on" })
      : FlagTarget.cases.off.make({}),
  });

it.effect.prop(
  "empty KV preserves Config, deploy-only values ignore KV, and unavailable replicas use catalog defaults",
  {
    enabled: Schema.Boolean,
    identity: Schema.Literals(["daily", "persistent"]),
  },
  ({ enabled, identity }) =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;

      const fallback = configFlagsLayer(eventFlags).pipe(
        Layer.provide(
          ConfigProvider.layer(
            ConfigProvider.fromUnknown({
              EVENTS_ENABLED: String(enabled),
              EVENTS_IDENTITY_MODE: identity,
            })
          )
        )
      );

      const flags = yield* Flags.pipe(
        Effect.provide(
          kvFlagsLayer(eventFlags, double.kv, [eventsEnabled.name]).pipe(
            Layer.provide(fallback)
          )
        )
      );

      expect(yield* flags.get(eventsEnabled, {})).toBe(enabled);
      expect(yield* flags.get(eventsIdentityMode, {})).toBe(identity);
      yield* double.kv.put(
        `values/${eventsEnabled.name}`,
        JSON.stringify(!enabled)
      );
      expect(yield* flags.get(eventsEnabled, {})).toBe(enabled);
      yield* double.kv.put(
        `values/${eventsIdentityMode.name}`,
        JSON.stringify(identity === "daily" ? "persistent" : "daily")
      );
      expect(yield* flags.get(eventsIdentityMode, {})).toBe(
        identity === "daily" ? "persistent" : "daily"
      );
      yield* Ref.set(double.failure, "read");
      expect(yield* flags.get(eventsIdentityMode, {})).toBe(
        eventsIdentityMode.default
      );
    })
);

it.effect(
  "attempt storage gates writes; failed outcome leaves Pending beside the authoritative committed receipt",
  () =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;

      const layer = Layer.merge(
        kvFlagsLayer([switchFlag], double.kv).pipe(
          Layer.provide(Flags.defaults([switchFlag]))
        ),
        kvFlagControlLayer([switchFlag], double.kv, {
          authoritativeWrites: "accept-non-atomic-unserialized",
        })
      );

      yield* Effect.gen(function* inspectAuditFailure() {
        const flags = yield* Flags;
        const journal = yield* FlagJournal;
        yield* prepareOn;
        yield* Ref.set(double.writes, []);
        yield* Ref.set(double.failure, "attempts/");
        expect((yield* flip(true).pipe(Effect.flip))._tag).toBe(
          "FlagStorageError"
        );
        expect(yield* flags.get(switchFlag, {})).toBe(false);
        expect(yield* Ref.get(double.writes)).toHaveLength(0);
        yield* Ref.set(double.failure, "outcomes/");
        expect((yield* flip(true).pipe(Effect.flip))._tag).toBe(
          "FlagStorageError"
        );
        expect(yield* flags.get(switchFlag, {})).toBe(true);
        expect(
          (yield* FlagLedger.use((ledger) => ledger.read(switchFlag.name)))
            .receipt?.to
        ).toBe("on");
        yield* TestClock.adjust(100);
        const page = yield* journal.list({ limit: 1 });
        expect(page.changes).toHaveLength(1);
        expect(page.changes[0]?.outcome).toBe("Pending");
        expect(page.changes[0]?.ageMillis).toBe(100);
      }).pipe(Effect.provide(Layer.merge(layer, Approval.allowAll)));
    }).pipe(Effect.provide(NodeCrypto.layer))
);

it.effect(
  "interruption while waiting for approval preserves Pending and never applies a value",
  () =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;
      const gate = yield* Deferred.make<boolean>();

      const layer = Layer.merge(
        kvFlagsLayer([switchFlag], double.kv).pipe(
          Layer.provide(Flags.defaults([switchFlag]))
        ),
        kvFlagControlLayer([switchFlag], double.kv, {
          authoritativeWrites: "accept-non-atomic-unserialized",
        })
      );

      yield* Effect.gen(function* interruptApproval() {
        const journal = yield* FlagJournal;

        const fiber = yield* flip(true).pipe(
          Effect.provideService(Approval, {
            approve: () =>
              Deferred.succeed(gate, true).pipe(Effect.andThen(Effect.never)),
          }),
          Effect.forkChild
        );

        yield* Deferred.await(gate);
        expect((yield* journal.list({ limit: 1 })).changes[0]?.outcome).toBe(
          "Pending"
        );
        yield* Fiber.interrupt(fiber);
        expect((yield* journal.list({ limit: 1 })).changes[0]?.outcome).toBe(
          "Pending"
        );
        expect(
          (yield* FlagLedger.use((ledger) => ledger.read(switchFlag.name))).rung
        ).toBe("off");
      }).pipe(Effect.provide(layer));
    }).pipe(Effect.scoped, Effect.provide(NodeCrypto.layer))
);

it.effect.prop(
  "journals reject page limits outside their bounded read contract",
  {
    limit: Schema.Union([
      Schema.Int.check(Schema.isBetween({ maximum: 0, minimum: -100 })),
      Schema.Int.check(Schema.isBetween({ maximum: 200, minimum: 101 })),
    ]),
  },
  ({ limit }) =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;

      for (const layer of [
        FlagJournal.memory,
        kvFlagControlLayer([switchFlag], double.kv),
      ]) {
        const error = yield* FlagJournal.use((journal) =>
          journal.list({ limit })
        ).pipe(Effect.provide(layer), Effect.flip);

        expect(error._tag).toBe("FlagStorageError");
        expect(error.operation).toBe("listChanges");
      }
    })
);

it.effect(
  "journal pages pair immutable outcomes with their own attempts and reject corruption",
  () =>
    Effect.gen(function* compareFlagHistory() {
      const double = yield* makeKVDouble;

      const layer = Layer.merge(
        kvFlagsLayer([switchFlag], double.kv).pipe(
          Layer.provide(Flags.defaults([switchFlag]))
        ),
        kvFlagControlLayer([switchFlag], double.kv, {
          authoritativeWrites: "accept-non-atomic-unserialized",
        })
      );

      yield* Effect.gen(function* corruptJournal() {
        for (const value of [true, false, true]) {
          yield* TestClock.adjust(1);

          if (value) {
            yield* prepareOn;
          }

          yield* flip(value);
        }

        const journal = yield* FlagJournal;
        const first = yield* journal.list({ limit: 2 });
        expect(first.changes).toHaveLength(2);
        expect(first.cursor).toBeDefined();
        const second = yield* journal.list({ cursor: first.cursor, limit: 2 });
        expect(second.changes).toHaveLength(1);
        expect(second.cursor).toBeUndefined();
        const writes = yield* Ref.get(double.writes);
        expect(
          new Set(
            writes.filter(
              (key) =>
                key.startsWith("attempts/") || key.startsWith("outcomes/")
            )
          ).size
        ).toBe(6);
        const [entry] = first.changes;

        if (entry === undefined) {
          return yield* Effect.die(new Error("Missing journal attempt."));
        }

        for (const corrupted of [
          "invalid-json",
          JSON.stringify({ ...entry, actor: "other" }),
          JSON.stringify({ ...entry, newValue: false }),
          JSON.stringify({ ...entry, outcome: "Pending" }),
        ]) {
          yield* double.kv.put(`outcomes/${entry.attemptId}`, corrupted);
          expect(
            (yield* journal.list({ limit: 2 }).pipe(Effect.flip))._tag
          ).toBe("FlagStorageError");
        }

        yield* double.kv.put(
          `attempts/${entry.attemptId}`,
          JSON.stringify({ ...entry, attemptId: "other", outcome: "Pending" })
        );
        expect((yield* journal.list({ limit: 2 }).pipe(Effect.flip))._tag).toBe(
          "FlagStorageError"
        );

        return yield* Effect.void;
      }).pipe(Effect.provide(Layer.merge(layer, Approval.allowAll)));
    }).pipe(Effect.provide(NodeCrypto.layer))
);

const scopedSwitch = defineFlag("SCOPED_SWITCH", Schema.Boolean, {
  default: false,
  owner: "tests",
  purpose: "Exercise authoritative KV positions per scope.",
  readScope: Schema.Literals(["alpha", "beta"]),
  removeBy: "2099-01-01",
  rungs: binaryLadder(false, true),
});

const storageFields = (error: { readonly _tag: string }) =>
  Schema.is(FlagStorageError)(error)
    ? { flag: error.flag, operation: error.operation }
    : error._tag;

const acceptedLedger = (
  kv: Parameters<typeof kvFlagControlLayer>[1],
  deployOnly: readonly string[] = []
) =>
  FlagLedger.pipe(
    Effect.provide(
      kvFlagControlLayer([scopedSwitch], kv, {
        authoritativeWrites: "accept-non-atomic-unserialized",
        deployOnly,
      })
    )
  );

const scopedEvidence = (scope: "alpha" | "beta") => ({
  event: "check",
  name: scopedSwitch.name,
  observed: 1,
  read: "acceptance report",
  ref: "scoped evidence",
  rung: "off",
  scope,
});

const scopedClimb = (scope: "alpha" | "beta") => ({
  authority: "agent" as const,
  name: scopedSwitch.name,
  reason: "Climb after recorded evidence.",
  scope,
  target: FlagTarget.cases.rung.make({ name: "on" }),
});

it.effect.prop(
  "accepted KV writes report state and replica failures without claiming a clean commit",
  {
    phase: Schema.Literals(["state/", "values/"]),
    scope: Schema.Literals(["alpha", "beta"]),
  },
  ({ phase, scope }) =>
    Effect.gen(function* failAcceptedWrite() {
      const double = yield* makeKVDouble;
      const ledger = yield* acceptedLedger(double.kv);
      yield* Ref.set(double.failure, "state/");

      const evidenceError = yield* ledger
        .recordEvidence(scopedEvidence(scope))
        .pipe(Effect.flip);

      expect(storageFields(evidenceError)).toMatchObject({
        flag: scopedSwitch.name,
        operation: "write",
      });
      yield* Ref.set(double.failure, null);
      expect((yield* ledger.read(scopedSwitch.name, scope)).evidence).toEqual(
        []
      );
      yield* ledger.recordEvidence(scopedEvidence(scope));
      yield* Ref.set(double.failure, phase);

      const flipError = yield* ledger
        .flip(scopedClimb(scope))
        .pipe(Effect.flip);

      expect(storageFields(flipError)).toMatchObject({
        flag: scopedSwitch.name,
        operation: "write",
      });
      yield* Ref.set(double.failure, null);

      const values = [...(yield* Ref.get(double.data)).keys()].filter((key) =>
        key.startsWith("values/")
      );

      expect(values).toEqual([]);
      expect((yield* ledger.read(scopedSwitch.name, scope)).revision).toBe(
        phase === "state/" ? 0 : 1
      );
    })
);

it.effect.prop(
  "deployment-only flags refuse ledger writes without touching KV",
  { scope: Schema.Literals(["alpha", "beta"]) },
  ({ scope }) =>
    Effect.gen(function* refuseDeployOnlyWrite() {
      const double = yield* makeKVDouble;
      const ledger = yield* acceptedLedger(double.kv, [scopedSwitch.name]);

      const error = yield* ledger
        .recordEvidence(scopedEvidence(scope))
        .pipe(Effect.flip);

      expect(storageFields(error)).toMatchObject({
        flag: scopedSwitch.name,
        operation: "write",
      });
      expect(yield* Ref.get(double.writes)).toEqual([]);
    })
);

it.effect.prop(
  "unavailable and malformed authoritative positions fail rather than becoming initial positions",
  {
    fault: Schema.Literals(["unavailable", "malformed"]),
    scope: Schema.Literals(["alpha", "beta"]),
  },
  ({ fault, scope }) =>
    Effect.gen(function* failAuthoritativeRead() {
      const double = yield* makeKVDouble;
      const ledger = yield* acceptedLedger(double.kv);
      expect((yield* ledger.read(scopedSwitch.name, scope)).revision).toBe(0);
      yield* ledger.recordEvidence(scopedEvidence(scope));
      yield* ledger.flip(scopedClimb(scope));
      const key = `state/${flagPartition(scopedSwitch.name, scope)}`;

      yield* fault === "unavailable"
        ? Ref.set(double.failure, "read")
        : double.kv.put(key, "invalid-json");

      const before = (yield* Ref.get(double.data)).get(key);
      yield* Ref.set(double.writes, []);

      const error = yield* ledger
        .read(scopedSwitch.name, scope)
        .pipe(Effect.flip);

      expect(storageFields(error)).toMatchObject({
        flag: flagPartition(scopedSwitch.name, scope),
        operation: "read",
      });

      const writeError = yield* ledger
        .flip({
          ...scopedClimb(scope),
          target: FlagTarget.cases.off.make({}),
        })
        .pipe(Effect.flip);

      expect(storageFields(writeError)).toMatchObject({
        operation: "read",
      });
      expect(yield* Ref.get(double.writes)).toEqual([]);
      expect((yield* Ref.get(double.data)).get(key)).toBe(before);
    })
);
