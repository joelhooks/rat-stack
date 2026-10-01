import { Context, Effect, Layer, Redacted, Schema, Option } from "effect";
import { HttpClient, HttpClientRequest } from "effect/unstable/http";

import { ShieldRefused } from "./shield-refused.js";

export const SHIELD_VERIFY_URL = "https://app.postshiba.com/shield/v1/verify";

const VERIFY_TIMEOUT = "5 seconds";

export const ShieldReceiptSchema = Schema.Struct({
  verdict: Schema.Literal("good_boy"),
  verificationId: Schema.String,
  verifiedAt: Schema.String,
});

export type ShieldReceipt = typeof ShieldReceiptSchema.Type;

export class ShieldVerifier extends Context.Service<
  ShieldVerifier,
  {
    readonly verify: (
      token: string,
      email: string
    ) => Effect.Effect<
      { readonly verdict: "good_boy"; readonly verifiedAt: string },
      ShieldRefused
    >;
  }
>()("@rat-stack/core/ShieldVerifier") {}

const VerifyResponse = Schema.Struct({
  created_at: Schema.String,
  success: Schema.Boolean,
  verdict: Schema.String,
});

const decodeVerifyResponse = Schema.decodeUnknownEffect(VerifyResponse);

export const shieldVerifierLayer = (settings: {
  readonly secret: Option.Option<Redacted.Redacted>;
  readonly url?: string;
}) =>
  Layer.effect(
    ShieldVerifier,
    Effect.gen(function* makeShieldVerifier() {
      const http = yield* HttpClient.HttpClient;

      const verify = Effect.fn("ShieldVerifier.verify")(function* verify(
        token: string,
        email: string
      ) {
        if (Option.isNone(settings.secret)) {
          return yield* new ShieldRefused({ reason: "no_secret" });
        }

        if (token.trim() === "") {
          return yield* new ShieldRefused({ reason: "no_token" });
        }

        const request = HttpClientRequest.post(
          settings.url ?? SHIELD_VERIFY_URL
        ).pipe(
          HttpClientRequest.bodyJsonUnsafe({
            email,
            secret: Redacted.value(settings.secret.value),
            token,
          })
        );

        const response = yield* http.execute(request).pipe(
          Effect.timeout(VERIFY_TIMEOUT),
          Effect.mapError(() => new ShieldRefused({ reason: "unreachable" }))
        );

        if (response.status !== 200) {
          return yield* new ShieldRefused({
            reason: `http_${String(response.status)}`,
          });
        }

        const body = yield* response.json.pipe(
          Effect.flatMap(decodeVerifyResponse),
          Effect.mapError(() => new ShieldRefused({ reason: "malformed" }))
        );

        if (!body.success || body.verdict !== "good_boy") {
          return yield* new ShieldRefused({ reason: "not_passed" });
        }

        return { verdict: "good_boy", verifiedAt: body.created_at } as const;
      });

      return { verify };
    })
  );
