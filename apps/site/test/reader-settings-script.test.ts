import { expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as Digest from "effect/crypto/Digest";
import * as Base64 from "effect/encoding/Base64";

import {
  readerSettingsScript,
  readerSettingsScriptHash,
} from "../src/reader-settings-script.js";
import { readerContentSecurityPolicy } from "../src/security.js";

it.effect("the reader CSP allows exactly the inline settings script", () =>
  Effect.gen(function* settingsScriptHash() {
    const digest = yield* Digest.Digest;

    const bytes = yield* digest.digest(
      Digest.sha256,
      new TextEncoder().encode(readerSettingsScript)
    );

    expect(readerSettingsScriptHash).toBe(`'sha256-${Base64.encode(bytes)}'`);
    expect(readerContentSecurityPolicy).toContain(readerSettingsScriptHash);
  }).pipe(Effect.provide(Digest.layerWebCrypto))
);
