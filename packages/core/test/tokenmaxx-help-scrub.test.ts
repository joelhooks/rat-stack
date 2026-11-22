import { describe, expect, it } from "@effect/vitest";
import * as Arbitrary from "effect/Arbitrary";

import { scrubSecrets } from "../src/tokenmaxx-help-scrub.js";
import { noise, plantedSecret, windowsOf } from "./fixtures/help-secrets.js";

describe("setup report scrubbing", () => {
  it.prop(
    "no ten-character piece of a planted secret survives, wherever it sits in error output",
    {
      after: noise,
      before: noise,
      copies: Arbitrary.array(plantedSecret, { maxLength: 3, minLength: 1 }),
    },
    ({ after, before, copies }) => {
      const scrubbed = scrubSecrets(
        `${before}${copies.map((copy) => copy.text).join("\n")}\n${after}`
      );

      expect(scrubbed.redacted).toBe(true);

      for (const copy of copies) {
        for (const piece of windowsOf(copy.secret, 10)) {
          expect(scrubbed.text, copy.kind).not.toContain(piece);
        }
      }
    }
  );

  it.prop(
    "ordinary setup output passes through unchanged and is not marked redacted",
    { text: noise },
    ({ text }) => {
      expect(scrubSecrets(text)).toStrictEqual({ redacted: false, text });
    }
  );

  it.prop(
    "scrubbing is idempotent, so a stored report never changes when scrubbed again",
    { after: noise, before: noise, secret: plantedSecret },
    ({ after, before, secret }) => {
      const once = scrubSecrets(`${before}${secret.text} ${after}`).text;

      expect(scrubSecrets(once)).toStrictEqual({
        redacted: false,
        text: once,
      });
    }
  );
});
