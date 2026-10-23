import { FlagStorageError } from "@rat-stack/core/flags";
import { Effect, Schema } from "effect";

export const flagRemoteCall = <A, E, F>(
  name: string,
  operation: FlagStorageError["operation"],
  failure: Schema.ConstraintDecoder<F>,
  call: Effect.Effect<A, E>
) =>
  call.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Schema.decodeUnknownEffect(failure)(error).pipe(
          Effect.orElseSucceed(
            () =>
              new FlagStorageError({
                cause: error,
                fallback: null,
                name,
                operation,
                repair:
                  "Restore the Durable Object connection. Read the authoritative ledger before retrying a pending write.",
              })
          ),
          Effect.flatMap(Effect.fail)
        ),
      onSuccess: Effect.succeed,
    })
  );
