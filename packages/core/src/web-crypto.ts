import { Crypto, Effect, Layer } from "effect";

export const webCrypto = Crypto.make({
  digest: (algorithm, data) =>
    Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- Web Crypto owns this Promise-returning boundary.
      () => globalThis.crypto.subtle.digest(algorithm, Uint8Array.from(data))
    ).pipe(Effect.map((digest) => new Uint8Array(digest))),
  randomBytes: (size) =>
    globalThis.crypto.getRandomValues(new Uint8Array(size)),
});

export const webCryptoLayer = Layer.succeed(Crypto.Crypto, webCrypto);
