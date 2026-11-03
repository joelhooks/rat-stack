import { expect, it } from "@effect/vitest";
import {
  FlagLedger,
  FlagPosition,
  FlagTarget,
} from "@rat-stack/core/flag-control";
import {
  FlagStateStore,
  flagLedgerEngine,
} from "@rat-stack/core/flag-ledger-engine";
import { Flags, FlagStorageError } from "@rat-stack/core/flags";
import { Clock, Effect, Exit, Layer, Option, Ref, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { flagValueKey, kvFlagsLayer } from "../src/kv.js";
import {
  redriveFlagProjections,
  runFlagProjectionAlarm,
} from "../src/projection.js";
import { switchFlag } from "./flag-fixture.js";
import { makeKVDouble } from "./kv-double.js";

it.effect.prop(
  "an exhausted provider alarm retains failure and schedules a fresh retry window",
  {
    retryCount: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
  },
  ({ retryCount }) =>
    Effect.gen(function* checkAlarmRearm() {
      const scheduled = yield* Ref.make(Option.none<number>());
      const now = yield* Clock.currentTimeMillis;

      const result = yield* runFlagProjectionAlarm(
        Effect.die(new Error("Replica unavailable")),
        (at) => Ref.set(scheduled, Option.some(at)),
        retryCount
      ).pipe(Effect.exit);

      expect(Exit.isFailure(result)).toBe(true);
      expect(yield* Ref.get(scheduled)).toStrictEqual(
        retryCount === 6 ? Option.some(now + 128_000) : Option.none()
      );
    })
);

const Command = Schema.Literals([
  "on",
  "off",
  "crash",
  "redrive",
  "replicaFailure",
]);

const failure = () =>
  new FlagStorageError({
    cause: "Replica unavailable",
    fallback: null,
    flag: switchFlag.name,
    operation: "write",
    repair: "Retry the retained marker.",
  });

it.effect.prop(
  "committed receipts survive restart before projection, and redrive converges the read replica",
  {
    commands: Arbitrary.array(Arbitrary.schema(Command), { maxLength: 30 }),
  },
  ({ commands }) =>
    Effect.gen(function* checkProjectionHistory() {
      const double = yield* makeKVDouble;

      const durable = yield* Ref.make<{
        readonly position?: typeof FlagPosition.Type;
        readonly dirty: ReadonlyMap<string, string>;
      }>({ dirty: new Map() });

      const store = Layer.succeed(FlagStateStore, {
        load: () =>
          Ref.get(durable).pipe(
            Effect.map((current) => Option.fromUndefinedOr(current.position))
          ),
        save: (key, position) =>
          Schema.encodeEffect(Schema.fromJsonString(FlagPosition))(
            position
          ).pipe(
            Effect.orDie,
            Effect.flatMap((text) =>
              Ref.update(durable, (current) => ({
                dirty:
                  position.receipt === undefined
                    ? current.dirty
                    : new Map([[key, text]]),
                position,
              }))
            )
          ),
      });

      const engine = flagLedgerEngine.pipe(
        Layer.provide(Layer.merge(Flags.defaults([switchFlag]), store))
      );

      const readers = kvFlagsLayer([switchFlag], double.kv).pipe(
        Layer.provide(Flags.defaults([switchFlag]))
      );

      const project = redriveFlagProjections({
        pending: () =>
          Ref.get(durable).pipe(Effect.map((current) => current.dirty)),
        rearm: () => Effect.void,
        removeIfCurrent: (key, text) =>
          Ref.update(durable, (current) => ({
            ...current,
            dirty: new Map(
              [...current.dirty].filter(
                ([candidate, held]) => candidate !== key || held !== text
              )
            ),
          })),
        writeReplica: (key, value) =>
          double.kv.put(key, value).pipe(Effect.mapError(failure)),
      });

      let authoritative = false;
      let projected = false;

      const sequence: readonly (typeof Command.Type)[] = [
        "on",
        "crash",
        "replicaFailure",
        "redrive",
        ...commands,
        "redrive",
      ];

      for (const step of sequence) {
        const ledger = yield* FlagLedger.pipe(Effect.provide(engine));

        if (step === "on" && !authoritative) {
          yield* ledger.recordEvidence({
            event: "check",
            name: switchFlag.name,
            observed: 1,
            read: "acceptance report",
            ref: "acceptance report",
            rung: "off",
          });
          yield* ledger.flip({
            authority: "agent",
            name: switchFlag.name,
            reason: "test",
            target: FlagTarget.cases.rung.make({ name: "on" }),
          });
          authoritative = true;
        }

        if (step === "off") {
          yield* ledger.flip({
            authority: "agent",
            name: switchFlag.name,
            reason: "test",
            target: FlagTarget.cases.off.make({}),
          });
          authoritative = false;
        }

        if (step === "replicaFailure") {
          yield* Ref.set(double.failure, "values/");
          const before = yield* Ref.get(durable);
          const result = yield* project.pipe(Effect.exit);
          expect((yield* Ref.get(durable)).dirty).toStrictEqual(before.dirty);
          expect(
            before.dirty.size === 0
              ? Exit.isSuccess(result)
              : Exit.findErrorOption(result).pipe(
                  Option.exists(Schema.is(FlagStorageError))
                )
          ).toBe(true);
          yield* Ref.set(double.failure, null);
        }

        if (step === "redrive") {
          yield* project;
          projected = authoritative;
          expect((yield* Ref.get(durable)).dirty.size).toBe(0);
        }

        const position = yield* ledger.read(switchFlag.name);
        expect(position.value).toBe(authoritative);

        if (position.revision > 0) {
          expect(position.receipt?.value).toBe(authoritative);
        }

        expect(
          yield* Flags.use((flags) => flags.get(switchFlag, {})).pipe(
            Effect.provide(readers)
          )
        ).toBe(projected);
      }

      expect(
        (yield* Ref.get(double.data)).get(flagValueKey(switchFlag.name))
      ).toBe(JSON.stringify(authoritative));
    })
);

const BadMarker = Schema.Literals(["malformedJson", "missingReceipt"]);

const committedPosition = (name: string, value: boolean) => ({
  evidence: [],
  receipt: {
    actor: "agent",
    approvalRef: null,
    authority: "agent" as const,
    evidenceRefs: [],
    from: "off",
    name,
    reason: "test",
    revision: 1,
    scope: "global",
    to: "on",
    value,
  },
  revision: 1,
  rung: "on",
  value,
});

const encodePosition = Schema.encodeEffect(Schema.fromJsonString(FlagPosition));

it.effect.prop(
  "a projection marker that cannot be projected fails redrive and stays dirty",
  {
    bad: BadMarker,
    badAt: Schema.Int.check(Schema.isBetween({ maximum: 6, minimum: 0 })),
    goods: Schema.Array(Schema.Boolean).check(Schema.isMaxLength(6)),
  },
  ({ bad, badAt, goods }) =>
    Effect.gen(function* checkBadMarker() {
      const badKey = "marker/bad";
      const badName = "bad-flag";

      const committed = yield* encodePosition(
        committedPosition(badName, true)
      ).pipe(Effect.orDie);

      const { receipt: _receipt, ...uncommitted } = committedPosition(
        badName,
        true
      );

      const badText =
        bad === "malformedJson"
          ? committed.slice(0, -1)
          : yield* encodePosition(uncommitted).pipe(Effect.orDie);

      const good = yield* Effect.all(
        goods.map((value, index) =>
          encodePosition(committedPosition(`flag-${index}`, value)).pipe(
            Effect.orDie,
            Effect.map((text) => [`marker/${index}`, text] as const)
          )
        )
      );

      const at = Math.min(badAt, good.length);

      const dirty = yield* Ref.make<ReadonlyMap<string, string>>(
        new Map([...good.slice(0, at), [badKey, badText], ...good.slice(at)])
      );

      const writes = yield* Ref.make<readonly string[]>([]);

      const result = yield* redriveFlagProjections({
        pending: () => Ref.get(dirty),
        rearm: () => Effect.void,
        removeIfCurrent: (key, text) =>
          Ref.update(
            dirty,
            (current) =>
              new Map(
                [...current].filter(
                  ([candidate, held]) => candidate !== key || held !== text
                )
              )
          ),
        writeReplica: (key) => Ref.update(writes, (keys) => [...keys, key]),
      }).pipe(Effect.exit);

      const error = Exit.findErrorOption(result);
      expect(Option.exists(error, Schema.is(FlagStorageError))).toBe(true);
      expect(error.pipe(Option.map((failed) => failed.flag))).toStrictEqual(
        Option.some(badKey)
      );
      expect((yield* Ref.get(dirty)).get(badKey)).toBe(badText);
      expect(yield* Ref.get(writes)).not.toContain(flagValueKey(badName));
    })
);
