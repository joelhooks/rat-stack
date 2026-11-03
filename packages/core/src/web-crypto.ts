import { Layer } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as SecureRandom from "effect/crypto/SecureRandom";

export const webCryptoLayer = Layer.mergeAll(
  SecureRandom.layerWebCrypto,
  Digest.layerWebCrypto
);
