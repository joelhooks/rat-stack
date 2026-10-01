import { expect, it } from "@effect/vitest";
import { Effect, Encoding, Redacted } from "effect";

import { InterestTokens } from "../src/interest-token.js";

const secretLayer = InterestTokens.layer(Redacted.make("test-secret-one"));

const claims = { address: "reader@example.com", expiresAt: 10_000 };

it.layer(secretLayer)("interest tokens", (test) => {
  test.effect("round-trips the address and expiry", () =>
    Effect.gen(function* roundTrips() {
      const tokens = yield* InterestTokens;
      const token = yield* tokens.sign(claims);

      expect(yield* tokens.verify(token, 9999)).toEqual(claims);
    })
  );

  test.effect(
    "hashes with a label so the ip and user agent hashes cannot collide",
    () =>
      Effect.gen(function* hashes() {
        const tokens = yield* InterestTokens;
        const ip = yield* tokens.digest("ip", "same-value");
        const again = yield* tokens.digest("ip", "same-value");
        const agent = yield* tokens.digest("ua", "same-value");

        expect(ip).toMatch(/^[0-9a-f]{64}$/u);
        expect(again).toBe(ip);
        expect(agent).not.toBe(ip);
      })
  );

  test.effect("refuses a token at or after its expiry", () =>
    Effect.gen(function* refusesExpired() {
      const tokens = yield* InterestTokens;
      const token = yield* tokens.sign(claims);
      const refusal = yield* Effect.flip(tokens.verify(token, 10_000));

      expect(refusal.reason).toBe("expired");
    })
  );

  test.effect("refuses a payload edited after signing", () =>
    Effect.gen(function* refusesTampering() {
      const tokens = yield* InterestTokens;
      const token = yield* tokens.sign(claims);
      const [, signature] = token.split(".");

      const forged = Encoding.encodeBase64Url(
        JSON.stringify({
          address: "someone-else@example.com",
          expiresAt: 10_000,
        })
      );

      const refusal = yield* Effect.flip(
        tokens.verify(`${forged}.${signature}`, 0)
      );

      expect(refusal.reason).toBe("signature");
    })
  );

  test.effect("refuses a signature with a flipped bit", () =>
    Effect.gen(function* refusesFlippedSignature() {
      const tokens = yield* InterestTokens;
      const token = yield* tokens.sign(claims);
      const [payload, signature] = token.split(".");
      const last = signature?.slice(-1) === "A" ? "B" : "A";
      const edited = `${payload}.${signature?.slice(0, -1)}${last}`;
      const refusal = yield* Effect.flip(tokens.verify(edited, 0));

      expect(refusal.reason).toBe("signature");
    })
  );

  test.effect("refuses tokens that are not two base64url parts", () =>
    Effect.gen(function* refusesMalformed() {
      const tokens = yield* InterestTokens;

      for (const token of ["", "abc", "a.b.c", "!!!.???"]) {
        const refusal = yield* Effect.flip(tokens.verify(token, 0));

        expect(refusal.reason).toBe("malformed");
      }
    })
  );

  test.effect("refuses a token signed with a different secret", () =>
    Effect.gen(function* refusesOtherSecret() {
      const tokens = yield* InterestTokens;
      const token = yield* tokens.sign(claims);

      const refusal = yield* Effect.flip(
        Effect.gen(function* verifyElsewhere() {
          const other = yield* InterestTokens;

          return yield* other.verify(token, 0);
        }).pipe(
          Effect.provide(InterestTokens.layer(Redacted.make("test-secret-two")))
        )
      );

      expect(refusal.reason).toBe("signature");
    })
  );
});

it.effect("hashes differently under a different secret", () =>
  Effect.gen(function* secretMatters() {
    const first = yield* InterestTokens.use((tokens) =>
      tokens.digest("ip", "value")
    ).pipe(Effect.provide(secretLayer));

    const second = yield* InterestTokens.use((tokens) =>
      tokens.digest("ip", "value")
    ).pipe(
      Effect.provide(InterestTokens.layer(Redacted.make("test-secret-two")))
    );

    expect(first).not.toBe(second);
  })
);
