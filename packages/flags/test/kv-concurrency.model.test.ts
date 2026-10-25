import { expect, it } from "@effect/vitest";
import { FlagLedger, FlagTarget } from "@rat-stack/core/flag-control";
import { defineFlag } from "@rat-stack/core/flags";
import {
  Cause,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Ref,
  Schema,
} from "effect";

import { kvFlagControlLayer } from "../src/kv.js";
import { binaryLadder } from "./flag-fixture.js";
import { makeKVDouble } from "./kv-double.js";

it.effect.prop(
  "independent KV compositions refuse concurrent double climbs without explicit acceptance",
  { initial: Schema.Boolean, scope: Schema.Literals(["alpha", "beta"]) },
  ({ initial, scope }) =>
    Effect.gen(function* concurrentClimbs() {
      const flag = defineFlag("CONCURRENT_SWITCH", Schema.Boolean, {
        default: initial,
        owner: "tests",
        purpose: "Expose competing KV writers at the same rung.",
        readScope: Schema.Literals(["alpha", "beta"]),
        removeBy: "2099-01-01",
        rungs: binaryLadder(initial, !initial),
      });

      const double = yield* makeKVDouble;

      const seedContext = yield* Layer.build(
        kvFlagControlLayer([flag], double.kv, {
          authoritativeWrites: "accept-non-atomic-unserialized",
        })
      );

      const seed = Context.get(seedContext, FlagLedger);

      const evidence = {
        event: "check",
        name: flag.name,
        observed: 1,
        read: "acceptance report",
        ref: "concurrent evidence",
        rung: "off",
        scope,
      };

      yield* seed.recordEvidence(evidence);

      const readers = yield* Ref.make(0);
      const bothRead = yield* Deferred.make<null>();

      const racingKV = {
        ...double.kv,
        get: (key: string) =>
          Effect.gen(function* captureConcurrentRead() {
            const value = yield* double.kv.get(key);

            if (key.startsWith("state/")) {
              const count = yield* Ref.updateAndGet(readers, (n) => n + 1);

              if (count === 2) {
                yield* Deferred.succeed(bothRead, null);
              }

              yield* Deferred.await(bothRead);
            }

            return value;
          }),
      };

      const leftContext = yield* Layer.build(
        kvFlagControlLayer([flag], racingKV)
      );

      const rightContext = yield* Layer.build(
        kvFlagControlLayer([flag], racingKV)
      );

      const left = Context.get(leftContext, FlagLedger);
      const right = Context.get(rightContext, FlagLedger);

      const input = {
        authority: "agent",
        name: flag.name,
        reason: "Two callers attempt the same next rung.",
        scope,
        target: FlagTarget.cases.rung.make({ name: "on" }),
      } satisfies Parameters<typeof left.flip>[0];

      const results = yield* Effect.all(
        [
          left.flip(input).pipe(Effect.exit),
          right.flip(input).pipe(Effect.exit),
        ],
        { concurrency: "unbounded" }
      );

      const outcomes = results.map((result) =>
        Exit.isFailure(result)
          ? Option.getOrUndefined(
              Option.map(
                Cause.findErrorOption(result.cause),
                (failure) => failure._tag
              )
            )
          : "Succeeded"
      );

      expect(outcomes).toEqual([
        "FlagAtomicityRequired",
        "FlagAtomicityRequired",
      ]);
      expect((yield* seed.read(flag.name, scope)).revision).toBe(0);
      expect((yield* seed.read(flag.name, scope)).value).toBe(initial);

      const defaults = Context.get(
        yield* Layer.build(kvFlagControlLayer([flag], double.kv)),
        FlagLedger
      );

      const evidenceFailure = yield* defaults
        .recordEvidence(evidence)
        .pipe(Effect.flip);

      expect(evidenceFailure._tag).toBe("FlagAtomicityRequired");

      const accepted = yield* seed.flip(input);
      expect(accepted.revision).toBe(1);
      expect(accepted.value).toBe(!initial);
    }).pipe(Effect.scoped)
);
