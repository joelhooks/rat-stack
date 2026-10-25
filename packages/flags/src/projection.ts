import { FlagPosition } from "@rat-stack/core/flag-control";
import { FlagStorageError } from "@rat-stack/core/flags";
import { Clock, Effect, Schema } from "effect";

import { flagValueKey } from "./kv.js";

export interface FlagProjectionPort {
  readonly pending: () => Effect.Effect<
    ReadonlyMap<string, string>,
    FlagStorageError
  >;
  readonly removeIfCurrent: (
    key: string,
    text: string
  ) => Effect.Effect<void, FlagStorageError>;
  readonly writeReplica: (
    key: string,
    value: string
  ) => Effect.Effect<void, FlagStorageError>;
  readonly rearm: () => Effect.Effect<void, FlagStorageError>;
}

const cloudflareAlarmRetryCount = 6;

const cloudflareAlarmInitialBackoffMillis = 2000;

export const runFlagProjectionAlarm = (
  redrive: Effect.Effect<void>,
  rearm: (at: number) => Effect.Effect<void>,
  retryCount = 0
) =>
  redrive.pipe(
    Effect.catchCause((cause) =>
      Effect.gen(function* rearmExhaustedProjection() {
        if (retryCount >= cloudflareAlarmRetryCount) {
          const now = yield* Clock.currentTimeMillis;
          yield* rearm(
            now +
              cloudflareAlarmInitialBackoffMillis *
                2 ** cloudflareAlarmRetryCount
          );
        }

        return yield* Effect.failCause(cause);
      })
    )
  );

export const redriveFlagProjections = Effect.fn("redriveFlagProjections")(
  function* redriveFlagProjections(port: FlagProjectionPort) {
    const dirty = yield* port.pending();

    for (const [key, text] of dirty) {
      const position = yield* Schema.decodeEffect(
        Schema.fromJsonString(FlagPosition)
      )(text).pipe(
        Effect.mapError(
          (cause) =>
            new FlagStorageError({
              cause,
              fallback: null,
              name: key,
              operation: "read",
              repair:
                "Repair the committed projection marker; do not delete it to hide the failure.",
            })
        )
      );

      if (position.receipt === undefined) {
        return yield* new FlagStorageError({
          cause: "Missing committed receipt",
          fallback: null,
          name: key,
          operation: "read",
          repair: "Restore the receipt before projecting this position.",
        });
      }

      yield* port.writeReplica(
        flagValueKey(position.receipt.name, position.receipt.scope),
        JSON.stringify(position.value)
      );
      yield* port.removeIfCurrent(key, text);
    }

    if (dirty.size === 100) {
      yield* port.rearm();
    }

    return yield* Effect.void;
  }
);
