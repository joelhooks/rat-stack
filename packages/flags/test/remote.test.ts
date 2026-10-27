import { expect, it } from "@effect/vitest";
import { FlagScopeMismatch, FlagStorageError } from "@rat-stack/core/flags";
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
