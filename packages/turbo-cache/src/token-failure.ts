import { Cause, Option, Predicate, Schema } from "effect";

import { TokenHandoffError } from "./token.js";

const SourceFailure = Schema.Struct({
  _tag: Schema.optional(Schema.String),
  message: Schema.String,
  name: Schema.optional(Schema.String),
});

export const stateReadFailure = (cause: Cause.Cause<unknown>) => {
  const source = Schema.decodeUnknownOption(SourceFailure)(Cause.squash(cause));

  const detail = Option.isSome(source)
    ? `${source.value._tag ?? source.value.name ?? "UnknownFailure"}: ${source.value.message}`
    : "UnknownFailure: No tagged source message is available.";

  const fix =
    Option.isSome(source) &&
    Predicate.isTagged(source.value, "CredentialsUnavailable")
      ? "inject `CLOUDFLARE_ACCOUNT_ID` and `CLOUDFLARE_API_TOKEN` with the operator's secret tool, then retry `pnpm turbo-cache:token`"
      : "verify the configured state store and stage; use the approved deployment workflow for any bootstrap or upgrade";

  return new TokenHandoffError({
    message: `The token handoff failed before sending a credential. ${detail} State provisioning remains disabled. Fix: ${fix}.`,
  });
};
