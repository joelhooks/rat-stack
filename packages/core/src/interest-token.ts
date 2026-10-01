import {
  Context,
  Effect,
  Encoding,
  Layer,
  Redacted,
  Result,
  Schema,
} from "effect";

import { InvalidInterestToken } from "./invalid-interest-token.js";

const Claims = Schema.Struct({
  address: Schema.String,
  expiresAt: Schema.Finite,
});

export type InterestClaims = typeof Claims.Type;

const encoder = new TextEncoder();

const decodeClaims = Schema.decodeUnknownEffect(Schema.fromJsonString(Claims));

const encodeClaims = Schema.encodeEffect(Schema.fromJsonString(Claims));

const importKey = (secret: Redacted.Redacted) =>
  Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
    () =>
      crypto.subtle.importKey(
        "raw",
        encoder.encode(Redacted.value(secret)),
        { hash: "SHA-256", name: "HMAC" },
        false,
        ["sign", "verify"]
      )
  );

export class InterestTokens extends Context.Service<
  InterestTokens,
  {
    readonly digest: (
      label: "ip" | "ua",
      value: string
    ) => Effect.Effect<string>;
    readonly sign: (claims: InterestClaims) => Effect.Effect<string>;
    readonly verify: (
      token: string,
      now: number
    ) => Effect.Effect<InterestClaims, InvalidInterestToken>;
  }
>()("@rat-stack/core/InterestTokens") {
  static readonly layer = (secret: Redacted.Redacted) =>
    Layer.effect(
      this,
      Effect.gen(function* makeInterestTokens() {
        const loadKey = yield* Effect.cached(importKey(secret));

        const sign = Effect.fn("InterestTokens.sign")(function* sign(
          claims: InterestClaims
        ) {
          const key = yield* loadKey;
          const payload = yield* encodeClaims(claims).pipe(Effect.orDie);

          const signature = yield* Effect.promise(
            // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
            () => crypto.subtle.sign("HMAC", key, encoder.encode(payload))
          );

          return `${Encoding.encodeBase64Url(payload)}.${Encoding.encodeBase64Url(new Uint8Array(signature))}`;
        });

        const verify = Effect.fn("InterestTokens.verify")(function* verify(
          token: string,
          now: number
        ) {
          const [encodedPayload, encodedSignature, ...rest] = token.split(".");

          if (
            encodedPayload === undefined ||
            encodedSignature === undefined ||
            rest.length > 0
          ) {
            return yield* new InvalidInterestToken({ reason: "malformed" });
          }

          const payload = Result.getOrUndefined(
            Encoding.decodeBase64UrlString(encodedPayload)
          );

          const signature = Result.getOrUndefined(
            Encoding.decodeBase64Url(encodedSignature)
          );

          if (payload === undefined || signature === undefined) {
            return yield* new InvalidInterestToken({ reason: "malformed" });
          }

          const key = yield* loadKey;

          const valid = yield* Effect.promise(
            // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
            () =>
              crypto.subtle.verify(
                "HMAC",
                key,
                signature,
                encoder.encode(payload)
              )
          );

          if (!valid) {
            return yield* new InvalidInterestToken({ reason: "signature" });
          }

          const claims = yield* decodeClaims(payload).pipe(
            Effect.mapError(
              () => new InvalidInterestToken({ reason: "malformed" })
            )
          );

          return claims.expiresAt <= now
            ? yield* new InvalidInterestToken({ reason: "expired" })
            : claims;
        });

        const digest = Effect.fn("InterestTokens.digest")(function* digest(
          label: "ip" | "ua",
          value: string
        ) {
          const key = yield* loadKey;

          const mac = yield* Effect.promise(
            // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
            () =>
              crypto.subtle.sign(
                "HMAC",
                key,
                encoder.encode(`ratstack:intake:${label}:v1\0${value}`)
              )
          );

          return [...new Uint8Array(mac)]
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        });

        return { digest, sign, verify } as const;
      })
    );
}
