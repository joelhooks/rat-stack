import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  FlagJournal,
  FlagLedger as LedgerPort,
  FlagPosition,
} from "@rat-stack/core/flag-control";
import {
  FlagStateStore,
  flagLedgerEngine,
} from "@rat-stack/core/flag-ledger-engine";
import {
  Flags,
  FlagStorageError,
  eventFlags,
  eventsEnabled,
} from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import type * as RuntimeContext from "alchemy/RuntimeContext";
import { Clock, Effect, Layer, Schema, Semaphore } from "effect";

import { flagsNamespace } from "./cloudflare-store.js";
import { kvFlagJournalLayer } from "./kv.js";
import {
  redriveFlagProjections,
  runFlagProjectionAlarm,
} from "./projection.js";

export type FlagLedgerOperations = LedgerPort["Service"] &
  FlagJournal["Service"] & {
    readonly alarm: (
      info?: Cloudflare.AlarmInvocationInfo
    ) => Effect.Effect<void>;
    readonly redrive: () => Effect.Effect<void>;
  };

export type FlagLedgerDefinition = Effect.Effect<
  Cloudflare.DurableObject<FlagLedgerOperations>,
  never,
  Cloudflare.Worker
> &
  (new (_: never) => FlagLedgerOperations);

export const defineFlagLedger = (
  registry: readonly Flag<unknown>[],
  deployOnly: readonly string[] = []
): FlagLedgerDefinition => {
  class FlagLedgerDefinition extends Cloudflare.DurableObject<FlagLedgerDefinition>()(
    "FlagLedger",
    Effect.gen(function* declareFlagLedger() {
      const state = yield* Cloudflare.DurableObjectState;
      const namespace = yield* flagsNamespace;
      const replica = yield* Cloudflare.KV.WriteNamespace(namespace);

      // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy constructs the per-instance program after resolving its infrastructure bindings.
      return Effect.gen(function* makeFlagLedgerInstance() {
        const runtime = yield* Effect.context<RuntimeContext.RuntimeContext>();

        const storage = <A, E>(
          effect: Effect.Effect<A, E, RuntimeContext.RuntimeContext>
        ) => effect.pipe(Effect.provideContext(runtime));

        const projectionGate = yield* Semaphore.make(1);

        const store = Layer.succeed(FlagStateStore, {
          load: (key) =>
            storage(state.storage.get<string>(`state/${key}`)).pipe(
              Effect.flatMap((text) =>
                text === undefined
                  ? Effect.succeedNone
                  : Schema.decodeEffect(Schema.fromJsonString(FlagPosition))(
                      text
                    ).pipe(Effect.asSome)
              ),
              Effect.mapError(
                (cause) =>
                  new FlagStorageError({
                    cause,
                    fallback: null,
                    flag: key,
                    operation: "read",
                    repair:
                      "Repair the authoritative ledger position before retrying.",
                  })
              )
            ),
          save: (key, position) =>
            Effect.gen(function* save() {
              const name = decodeURIComponent(key.split("/")[0] ?? "");

              if (deployOnly.includes(name)) {
                return yield* new FlagStorageError({
                  cause: "Deployment-only flag",
                  fallback: null,
                  flag: name,
                  operation: "write",
                  repair:
                    "Change deployment Config and review the infrastructure plan.",
                });
              }

              const text = yield* Schema.encodeEffect(
                Schema.fromJsonString(FlagPosition)
              )(position).pipe(
                Effect.mapError(
                  (cause) =>
                    new FlagStorageError({
                      cause,
                      fallback: null,
                      flag: name,
                      operation: "write",
                      repair: "Declare valid JSON ledger positions.",
                    })
                )
              );

              const now = yield* Clock.currentTimeMillis;

              yield* storage(
                state.storage.transaction(
                  Effect.gen(function* commitPosition() {
                    const previous = yield* state.storage.get<string>(
                      `state/${key}`
                    );

                    const prior =
                      previous === undefined
                        ? undefined
                        : yield* Schema.decodeEffect(
                            Schema.fromJsonString(FlagPosition)
                          )(previous);

                    yield* state.storage.put(`state/${key}`, text);

                    if (
                      position.receipt !== undefined &&
                      prior?.revision !== position.revision
                    ) {
                      yield* state.storage.put(`dirty/${key}`, text);
                      yield* state.storage.setAlarm(now);
                    }
                  })
                )
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new FlagStorageError({
                      cause,
                      fallback: null,
                      flag: name,
                      operation: "write",
                      repair:
                        "Restore the ledger transaction; inspect its pending attempt before retrying.",
                    })
                )
              );

              return yield* Effect.void;
            }),
        });

        const ledger = yield* LedgerPort.pipe(
          Effect.provide(
            flagLedgerEngine.pipe(
              Layer.provide(Layer.merge(Flags.defaults(registry), store))
            )
          )
        );

        const journal = yield* FlagJournal.pipe(
          Effect.provide(
            kvFlagJournalLayer({
              get: (key) =>
                storage(state.storage.get<string>(key)).pipe(
                  Effect.map((value) => value ?? null)
                ),
              list: ({ prefix, limit, cursor }) =>
                storage(
                  state.storage.list<string>(
                    cursor === undefined
                      ? { limit, prefix }
                      : { limit, prefix, startAfter: cursor }
                  )
                ).pipe(
                  Effect.map((entries) => ({
                    cursor: [...entries.keys()].at(-1),
                    keys: [...entries.keys()].map((name) => ({ name })),
                    list_complete: entries.size < limit,
                  }))
                ),
              put: (key, value) => storage(state.storage.put(key, value)),
            })
          )
        );

        const redrive = () =>
          redriveFlagProjections({
            pending: () =>
              storage(
                state.storage.list<string>({ limit: 100, prefix: "dirty/" })
              ),
            rearm: () =>
              Clock.currentTimeMillis.pipe(
                Effect.flatMap((now) => storage(state.storage.setAlarm(now)))
              ),
            removeIfCurrent: (key, text) =>
              storage(
                state.storage.transaction(
                  Effect.gen(function* clearProjectedMarker() {
                    const latest = yield* state.storage.get<string>(key);

                    if (latest === text) {
                      yield* state.storage.delete(key);
                    }
                  })
                )
              ).pipe(
                Effect.mapError(
                  (cause) =>
                    new FlagStorageError({
                      cause,
                      fallback: null,
                      flag: key,
                      operation: "write",
                      repair: "Retry the retained projection marker.",
                    })
                )
              ),
            writeReplica: (key, value) =>
              replica.put(key, value).pipe(
                Effect.provideContext(runtime),
                Effect.mapError(
                  (cause) =>
                    new FlagStorageError({
                      cause,
                      fallback: null,
                      flag: key,
                      operation: "write",
                      repair:
                        "Restore KV access; the committed projection marker remains pending.",
                    })
                )
              ),
          }).pipe((effect) => projectionGate.withPermit(effect), Effect.orDie);

        return {
          alarm: (info?: Cloudflare.AlarmInvocationInfo) =>
            runFlagProjectionAlarm(
              redrive(),
              (at) => storage(state.storage.setAlarm(at)),
              info?.retryCount
            ),
          flip: ledger.flip,
          list: journal.list,
          read: ledger.read,
          record: journal.record,
          recordEvidence: ledger.recordEvidence,
          redrive,
        };
      });
    }).pipe(Effect.provide(Cloudflare.KV.WriteNamespaceBinding))
  ) {}

  return FlagLedgerDefinition;
};

export const FlagLedger = defineFlagLedger(eventFlags, [eventsEnabled.name]);
