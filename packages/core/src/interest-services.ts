import { Effect } from "effect";

const encoder = new TextEncoder();

export const sha256Hex = Effect.fn("sha256Hex")(function* sha256Hex(
  value: string
) {
  const buffer = yield* Effect.promise(
    // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
    () => crypto.subtle.digest("SHA-256", encoder.encode(value))
  );

  return [...new Uint8Array(buffer)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
