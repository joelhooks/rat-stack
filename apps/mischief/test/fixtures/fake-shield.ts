import { ShieldRefused, ShieldVerifier } from "@rat-stack/core/interest";
import { Effect, Layer } from "effect";

export const PASSING_SHIELD_TOKEN = "pass-token";

export const fakeShieldLayer = Layer.succeed(ShieldVerifier, {
  verify: (token: string) =>
    token === PASSING_SHIELD_TOKEN
      ? Effect.succeed({
          verdict: "good_boy",
          verifiedAt: "2026-10-01T00:00:00Z",
        } as const)
      : Effect.fail(new ShieldRefused({ reason: "fake_refused" })),
});
