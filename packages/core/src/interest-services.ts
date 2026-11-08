import { Effect } from "effect";
import { Hex } from "effect/encoding";

const encoder = new TextEncoder();

export const sha256Hex = Effect.fn("sha256Hex")(function* sha256Hex(
  value: string
) {
  const buffer = yield* Effect.promise(() =>
    crypto.subtle.digest("SHA-256", encoder.encode(value))
  );

  return Hex.encode(new Uint8Array(buffer));
});

export const digestsMatch = Effect.fn("digestsMatch")(function* digestsMatch(
  left: string,
  right: string
) {
  const [leftDigest, rightDigest] = yield* Effect.all([
    sha256Hex(left),
    sha256Hex(right),
  ]);

  return leftDigest === rightDigest;
});
