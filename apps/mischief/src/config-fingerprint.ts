import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Redacted from "effect/Redacted";

export const MISCHIEF_CONFIG_NAMES = [
  "DROVR_API_BASE",
  "DROVR_AGENT_INTAKE_CREDENTIAL",
  "DROVR_INTAKE_CREDENTIAL",
  "DROVR_INTAKE_URL",
  "EVENTS_ENABLED",
  "EVENTS_IDENTITY_MODE",
  "INTEREST_MODE",
  "INTEREST_OPERATOR_TOKEN",
  "INTEREST_SEND_ENABLED",
  "INTEREST_TOKEN_SECRET",
  "POSTSHIBA_API_KEY",
  "POSTSHIBA_CLUSTER",
  "POSTSHIBA_TEAM",
  "TYPESAFE_API_KEY",
  "WEB_BOT_AUTH_ENABLED",
  "WEB_BOT_AUTH_PRIVATE_JWK",
] as const;

const encoder = new TextEncoder();

export const fingerprintOf = (
  entries: readonly (readonly [string, string | undefined])[]
) =>
  Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
    () =>
      crypto.subtle.digest(
        "SHA-256",
        encoder.encode(
          entries
            .map(([name, value]) => `${name}=${value ?? "\0unset"}`)
            .join("\n")
        )
      )
  ).pipe(
    Effect.map((digest) =>
      [...new Uint8Array(digest)]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    )
  );

export const mischiefConfigFingerprint = Config.all(
  MISCHIEF_CONFIG_NAMES.map((name) =>
    Config.option(Config.Redacted(name)).pipe(
      Config.map(
        (value) =>
          [
            name,
            value.pipe(
              Option.map((secret) => Redacted.value(secret)),
              Option.getOrUndefined
            ),
          ] as const
      )
    )
  )
).pipe(Config.mapEffect(fingerprintOf));
