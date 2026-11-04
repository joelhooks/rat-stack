import { FlagStorageError } from "@rat-stack/core/flags";
import { Effect, Predicate, Schema } from "effect";

const bridgedCause =
  "Raised by the remote flag ledger. Its cause stays on the remote side of the RPC bridge.";

const withBridgedCause = <E>(error: E) =>
  Predicate.isObject(error) && !Predicate.hasProperty(error, "cause")
    ? { ...error, cause: bridgedCause }
    : error;

export const flagRemoteCall = <A, E, F>(
  name: string,
  operation: FlagStorageError["operation"],
  failure: Schema.ConstraintDecoder<F>,
  call: Effect.Effect<A, E>
) =>
  call.pipe(
    Effect.matchEffect({
      onFailure: (error) =>
        Schema.decodeUnknownEffect(failure)(withBridgedCause(error)).pipe(
          Effect.orElseSucceed(
            () =>
              new FlagStorageError({
                cause: error,
                fallback: null,
                flag: name,
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
