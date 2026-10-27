import {
  FlagChangeSchema,
  PendingFlagChangeSchema,
  CompletedFlagChangeSchema,
  FlagJournal,
  FlagLedger,
  FlagAtomicityRequired,
  FlagPosition,
  flagPartition,
  validateFlagScope,
  validateFlagChangeQuery,
} from "@rat-stack/core/flag-control";
import type { ListFlagChangesInput } from "@rat-stack/core/flag-control";
import {
  FlagStateStore,
  flagLedgerEngine,
} from "@rat-stack/core/flag-ledger-engine";
import {
  FlagStorageError,
  Flags,
  decodeFlag,
  InvalidFlagValue,
} from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Clock, Effect, Layer, Schema } from "effect";

import { InvalidFlagJournal } from "./invalid-flag-journal.js";

export const flagValueKey = (name: string, scope: Schema.Json = "global") =>
  scope === "global"
    ? `values/${name}`
    : `values/${flagPartition(name, scope)}`;

const storageFailure =
  (name: string, operation: FlagStorageError["operation"]) =>
  (cause: unknown) =>
    new FlagStorageError({
      cause,
      fallback: null,
      flag: name,
      operation,
      repair:
        "Restore ledger storage. Inspect the pending attempt and authoritative position before retrying.",
    });

const kvLedgerLayer = <E>(
  registry: readonly Flag<unknown>[],
  kv: FlagKV<E>,
  deployOnly: readonly string[]
) => {
  const state = Layer.succeed(FlagStateStore, {
    load: (key) =>
      kv.get(`state/${key}`).pipe(
        Effect.flatMap((text) =>
          text === null
            ? Effect.succeedNone
            : Schema.decodeEffect(Schema.fromJsonString(FlagPosition))(
                text
              ).pipe(Effect.asSome)
        ),
        Effect.mapError(storageFailure(key, "read"))
      ),
    save: (key, position) =>
      Effect.gen(function* save() {
        const name = decodeURIComponent(key.split("/")[0] ?? "");

        if (deployOnly.includes(name)) {
          return yield* storageFailure(
            name,
            "write"
          )(
            "This flag selects deployment resources; change Config and review the infrastructure plan."
          );
        }

        const text = yield* Schema.encodeEffect(
          Schema.fromJsonString(FlagPosition)
        )(position).pipe(Effect.mapError(storageFailure(name, "write")));

        yield* kv
          .put(`state/${key}`, text)
          .pipe(Effect.mapError(storageFailure(name, "write")));

        if (position.receipt !== undefined) {
          yield* kv
            .put(
              flagValueKey(name, position.receipt.scope),
              JSON.stringify(position.value)
            )
            .pipe(Effect.mapError(storageFailure(name, "write")));
        }

        return yield* Effect.void;
      }),
  });

  return flagLedgerEngine.pipe(
    Layer.provide(Layer.merge(Flags.defaults(registry), state))
  );
};

export interface FlagKV<E> {
  readonly get: (key: string) => Effect.Effect<string | null, E>;
  readonly put: (key: string, value: string) => Effect.Effect<void, E>;
  readonly list: (input: {
    readonly prefix: string;
    readonly limit: number;
    readonly cursor?: string;
  }) => Effect.Effect<
    {
      readonly keys: readonly { readonly name: string }[];
      readonly cursor?: string | undefined;
      readonly list_complete: boolean;
    },
    E
  >;
}

const decodePending = Schema.decodeEffect(
  Schema.fromJsonString(PendingFlagChangeSchema)
);

const decodeCompleted = Schema.decodeEffect(
  Schema.fromJsonString(CompletedFlagChangeSchema)
);

const encodeChange = Schema.encodeEffect(
  Schema.fromJsonString(FlagChangeSchema)
);

const prefix = "attempts/";

const completionKey = (id: string) => `outcomes/${id}`;

export const kvFlagsLayer = <E>(
  registry: readonly Flag<unknown>[],
  kv: Pick<FlagKV<E>, "get">,
  deployOnly: readonly string[] = []
) =>
  Layer.effect(
    Flags,
    Effect.gen(function* makeKVFlags() {
      const fallback = yield* Flags;

      return Flags.of({
        get: (flag, context) =>
          Effect.gen(function* readKVFlag() {
            const scope = yield* validateFlagScope(flag, context.scope);
            const defaultValue = yield* fallback.get(flag, context);

            if (deployOnly.includes(flag.name)) {
              return defaultValue;
            }

            const encoded = yield* Schema.encodeEffect(flag.schema)(
              defaultValue
            ).pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(Schema.Json)),
              Effect.mapError(
                () =>
                  new InvalidFlagValue({
                    flag: flag.name,
                    repair: "Declare a flag with a JSON encoding.",
                  })
              )
            );

            const stored = yield* kv.get(flagValueKey(flag.name, scope)).pipe(
              Effect.mapError(
                (cause) =>
                  new FlagStorageError({
                    cause,
                    fallback: encoded,
                    flag: flag.name,
                    operation: "read",
                    repair:
                      "Restore KV access. The recorded fallback is the composition's Config value or declared default.",
                  })
              )
            );

            if (stored === null) {
              if (flag.failurePolicy === "refuse") {
                return yield* new FlagStorageError({
                  cause:
                    "The required flag value is absent from the read replica.",
                  fallback: encoded,
                  flag: flag.name,
                  operation: "read",
                  repair:
                    "Commit this scoped flag through its ledger and redrive the KV projection before reading it.",
                });
              }

              return defaultValue;
            }

            return yield* Schema.decodeEffect(
              Schema.fromJsonString(flag.schema)
            )(stored).pipe(
              Effect.mapError(
                () =>
                  new InvalidFlagValue({
                    flag: flag.name,
                    repair:
                      "Replace the stored KV value with its declared JSON encoding.",
                  })
              )
            );
          }).pipe(
            Effect.catchTags({
              FlagStorageError: (error) =>
                flag.failurePolicy === "use-catalog-default"
                  ? decodeFlag(flag)(flag.default)
                  : Effect.fail(error),
              InvalidFlagValue: (error) =>
                flag.failurePolicy === "use-catalog-default"
                  ? decodeFlag(flag)(flag.default)
                  : Effect.fail(error),
            })
          ),
        registry,
      });
    })
  );

export const kvFlagJournalLayer = <E>(kv: FlagKV<E>) =>
  Layer.succeed(FlagJournal, {
    list: Effect.fn("KVFlagJournal.list")(function* list(
      input: typeof ListFlagChangesInput.Type
    ) {
      const { cursor, limit } = yield* validateFlagChangeQuery(input);
      const now = yield* Clock.currentTimeMillis;

      const query =
        cursor === undefined ? { limit, prefix } : { cursor, limit, prefix };

      const result = yield* kv.list(query).pipe(
        Effect.mapError(
          (cause) =>
            new FlagStorageError({
              cause,
              fallback: null,
              flag: "",
              operation: "listChanges",
              repair: "Restore KV access and retry this cursor.",
            })
        )
      );

      const sameChange = Schema.toEquivalence(FlagChangeSchema);

      const changes = yield* Effect.forEach((key: { readonly name: string }) =>
        Effect.gen(function* readAttempt() {
          const pending = yield* kv.get(key.name);

          if (pending === null) {
            return yield* new InvalidFlagJournal({
              key: key.name,
              repair:
                "A listed flag attempt is not yet visible. Retry this cursor.",
            });
          }

          const attempt = yield* decodePending(pending);
          const finished = yield* kv.get(completionKey(attempt.attemptId));

          const change =
            finished === null ? attempt : yield* decodeCompleted(finished);

          if (
            key.name !== `${prefix}${attempt.attemptId}` ||
            !sameChange(attempt, {
              ...change,
              outcome: "Pending",
              recordedAt: attempt.recordedAt,
            })
          ) {
            return yield* new InvalidFlagJournal({
              key: key.name,
              repair:
                "The flag outcome does not match its attempt. Repair the journal entry.",
            });
          }

          return {
            ...change,
            ageMillis: Math.max(0, now - change.recordedAt),
          };
        }).pipe(
          Effect.mapError(
            (cause) =>
              new FlagStorageError({
                cause,
                fallback: null,
                flag: key.name,
                operation: "listChanges",
                repair:
                  "Restore or repair this journal entry, then retry the same cursor.",
              })
          )
        )
      )(result.keys);

      return {
        changes,
        cursor: result.list_complete ? undefined : result.cursor,
      };
    }),
    record: (change) =>
      encodeChange(change).pipe(
        Effect.flatMap((value) =>
          kv.put(
            change.outcome === "Pending"
              ? `${prefix}${change.attemptId}`
              : completionKey(change.attemptId),
            value
          )
        ),
        Effect.mapError(
          (cause) =>
            new FlagStorageError({
              cause,
              fallback: null,
              flag: change.name,
              operation: "audit",
              repair: `Inspect attempt ${change.attemptId}. Missing completion means Pending; the flag may have changed. Restore audit storage before retrying.`,
            })
        )
      ),
  });

export interface KVFlagControlOptions {
  readonly deployOnly?: readonly string[];
  readonly authoritativeWrites?: "accept-non-atomic-unserialized";
}

const refuseNonAtomicWrite = (flagName: string) =>
  Effect.fail(
    new FlagAtomicityRequired({
      flagName,
      repair:
        "KV cannot commit atomically or serialize writers across isolates. Use the Durable Object ledger, or set authoritativeWrites to accept-non-atomic-unserialized in the KV composition.",
    })
  );

export const kvFlagControlLayer = <E>(
  registry: readonly Flag<unknown>[],
  kv: FlagKV<E>,
  options: KVFlagControlOptions = {}
) => {
  const guarded = Layer.effect(
    FlagLedger,
    Effect.gen(function* guardKVWrites() {
      const ledger = yield* FlagLedger;

      if (options.authoritativeWrites === "accept-non-atomic-unserialized") {
        return ledger;
      }

      return {
        flip: (input: Parameters<typeof ledger.flip>[0]) =>
          refuseNonAtomicWrite(input.name),
        read: ledger.read,
        recordEvidence: (input: Parameters<typeof ledger.recordEvidence>[0]) =>
          refuseNonAtomicWrite(input.name),
      };
    })
  ).pipe(Layer.provide(kvLedgerLayer(registry, kv, options.deployOnly ?? [])));

  return Layer.merge(guarded, kvFlagJournalLayer(kv));
};
