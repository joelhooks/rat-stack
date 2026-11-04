import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import { FlagStorageError, InvalidFlagValue } from "@rat-stack/core/flags";
import { flagValueKey } from "@rat-stack/flags/kv";
import { Effect, Match, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  deployFlagLedger,
  failed,
  localServices,
  succeeded,
  tenantScope,
} from "./fixtures/flag-ledger-client.js";
import type { FlagLedgerClient } from "./fixtures/flag-ledger-client.js";
import {
  defaultedReadFlag,
  deployFlag,
  readRegistry,
  refusedReadFlag,
} from "./fixtures/flag-ledger-protocol.js";
import { kvStorage } from "./fixtures/local-storage.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `flag_read_runtime_${process.pid}`,
});

const Stored = Schema.Literals(["middle", "final"]);

const Replica = Schema.Union([
  Stored,
  Schema.Literals(["absent", "malformed", "unavailable"]),
]);

const ReadCase = Schema.Struct({
  flag: Schema.Literals([refusedReadFlag.name, defaultedReadFlag.name]),
  other: Stored,
  replica: Replica,
});

const storedText = (value: typeof Stored.Type) => JSON.stringify(value);

type ReadExpectation =
  | { readonly kind: "value"; readonly value: string }
  | {
      readonly kind: "error";
      readonly error: FlagStorageError | InvalidFlagValue;
    };

const readValue = (read: string): ReadExpectation => ({
  kind: "value",
  value: read,
});

const failure = (
  error: FlagStorageError | InvalidFlagValue
): ReadExpectation => ({
  error,
  kind: "error",
});

const expectedRead = (
  flag: typeof ReadCase.Type.flag,
  replica: typeof Replica.Type
) =>
  Match.value(replica).pipe(
    Match.when("absent", () =>
      flag === refusedReadFlag.name
        ? failure(
            new FlagStorageError({
              cause: "absent",
              fallback: "configured",
              flag,
              operation: "read",
              repair:
                "Commit this scoped flag through its ledger and redrive the KV projection before reading it.",
            })
          )
        : readValue("configured")
    ),
    Match.when("malformed", () =>
      flag === refusedReadFlag.name
        ? failure(
            new InvalidFlagValue({
              flag,
              repair:
                "Replace the stored KV value with its declared JSON encoding.",
            })
          )
        : readValue("declared")
    ),
    Match.when("unavailable", () =>
      flag === refusedReadFlag.name
        ? failure(
            new FlagStorageError({
              cause: "unavailable",
              fallback: "configured",
              flag,
              operation: "read",
              repair:
                "Restore KV access. The recorded fallback is the composition's Config value or declared default.",
            })
          )
        : readValue("declared")
    ),
    Match.orElse(readValue)
  );

const expectedFields = (error: FlagStorageError | InvalidFlagValue) => {
  const fields = { _tag: error._tag, flag: error.flag, repair: error.repair };

  return Schema.is(FlagStorageError)(error)
    ? { ...fields, fallback: error.fallback }
    : fields;
};

const checkRead = (
  outcome: Effect.Success<ReturnType<FlagLedgerClient["get"]>>,
  expected: ReadExpectation
) =>
  expected.kind === "value"
    ? succeeded(Schema.String)(outcome).pipe(
        Effect.flatMap((read) =>
          Effect.sync(() => {
            expect(read).toBe(expected.value);
          })
        )
      )
    : failed(outcome).pipe(
        Effect.flatMap((refusal) =>
          Effect.sync(() => {
            expect(refusal).toMatchObject(expectedFields(expected.error));
          })
        )
      );

test.provider(
  "live replica reads override Config per scope and keep each flag's declared failure policy",
  (stack) =>
    Effect.gen(function* checkReplicaReads() {
      const client = yield* deployFlagLedger(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.schema(ReadCase),
        ({ flag, other, replica }) =>
          Effect.gen(function* checkReplicaRead() {
            const scope = yield* tenantScope;
            const neighbour = yield* tenantScope;
            const neighbourKey = flagValueKey(flag, neighbour);

            yield* succeeded(Schema.Null)(
              yield* client.kvPut(neighbourKey, storedText(other))
            );

            yield* Match.value(replica).pipe(
              Match.when("absent", () => Effect.void),
              Match.when("unavailable", () => Effect.void),
              Match.when("malformed", () =>
                client.kvPut(flagValueKey(flag, scope), "not json")
              ),
              Match.orElse((value) =>
                client.kvPut(flagValueKey(flag, scope), storedText(value))
              )
            );

            const expected = expectedRead(flag, replica);

            if (replica === "unavailable") {
              const kv = yield* kvStorage(neighbourKey);

              yield* Effect.gen(function* readWhileUnavailable() {
                yield* kv.rejectReads;
                yield* checkRead(yield* client.get(flag, scope), expected);
              }).pipe(Effect.scoped);

              return true;
            }

            yield* checkRead(yield* client.get(flag, scope), expected);
            yield* checkRead(
              yield* client.get(flag, neighbour),
              readValue(other)
            );

            return true;
          }).pipe(Effect.scoped, Effect.orDie),
        { maxShrinks: 10, runs: 30 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

test.provider(
  "the live read layer lists its declared registry, reads unscoped flags from the global key, and ignores the replica for deployment-only flags",
  (stack) =>
    Effect.gen(function* checkGlobalAndDeploymentReads() {
      const client = yield* deployFlagLedger(stack);

      yield* client.kvPut(
        flagValueKey(defaultedReadFlag.name),
        storedText("final")
      );
      yield* client.kvPut(flagValueKey(deployFlag.name), JSON.stringify(false));

      expect(yield* client.registry()).toStrictEqual(
        readRegistry.map((flag) => flag.name)
      );

      yield* checkRead(
        yield* client.get(defaultedReadFlag.name),
        readValue("final")
      );

      expect(
        yield* succeeded(Schema.Boolean)(yield* client.get(deployFlag.name))
      ).toBe(true);
    }),
  { timeout: 120_000 }
);
