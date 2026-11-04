import { expect, it } from "@effect/vitest";
import { FlagScopeMismatch, FlagStorageError } from "@rat-stack/core/flags";
import { encodeRpcError } from "alchemy/Rpc";
import { Effect, Schema } from "effect";

import { flagRemoteCall } from "../src/remote.js";

class RemoteUnavailable extends Schema.TaggedError<
  RemoteUnavailable,
  { readonly brand: unique symbol }
>()("RemoteUnavailable", {}) {}

it.effect.prop(
  "remote scope failures regain their typed repair and unexpected transport failures become storage failures",
  {
    name: Schema.NonEmptyString,
    repair: Schema.NonEmptyString,
    scope: Schema.String,
  },
  ({ name, repair, scope }) =>
    Effect.gen(function* checkRemoteFailure() {
      const encoded = yield* Schema.encodeEffect(FlagScopeMismatch)(
        new FlagScopeMismatch({ flag: name, repair, scope })
      );

      const failure = yield* flagRemoteCall(
        name,
        "read",
        FlagScopeMismatch,
        Effect.fail(encoded)
      ).pipe(Effect.flip);

      expect(Schema.is(FlagScopeMismatch)(failure)).toBe(true);
      expect(failure.message).toBe(repair);

      const unavailable = yield* flagRemoteCall(
        name,
        "write",
        FlagScopeMismatch,
        Effect.fail(new RemoteUnavailable({}))
      ).pipe(Effect.flip);

      expect(Schema.is(FlagStorageError)(unavailable)).toBe(true);
      expect(unavailable.repair).toContain("authoritative ledger");
    })
);

it.effect.prop(
  "remote storage failures keep their own flag, operation, and repair after crossing the RPC wire",
  {
    caller: Schema.NonEmptyString,
    fallback: Schema.Json,
    flag: Schema.NonEmptyString,
    operation: FlagStorageError.fields.operation,
    repair: Schema.NonEmptyString,
  },
  ({ caller, fallback, flag, operation, repair }) =>
    Effect.gen(function* checkWireStorageFailure() {
      const raised = new FlagStorageError({
        cause: new Error("remote storage detail"),
        fallback,
        flag,
        operation,
        repair,
      });

      const wire = yield* Schema.decodeUnknownEffect(
        Schema.Record(Schema.String, Schema.Unknown)
      )(structuredClone(encodeRpcError(raised)));

      const failure = yield* flagRemoteCall(
        caller,
        "write",
        FlagStorageError,
        Effect.fail(wire)
      ).pipe(Effect.flip);

      expect(Schema.is(FlagStorageError)(failure)).toBe(true);
      expect(failure).toMatchObject({
        _tag: raised._tag,
        fallback: raised.fallback,
        flag: raised.flag,
        message: raised.message,
        operation: raised.operation,
        repair: raised.repair,
      });
    })
);
