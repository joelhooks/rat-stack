import { expect, it } from "@effect/vitest";
import { Cause, Effect, Exit, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { ApplicantName, ApplicantX } from "../src/join-identity.js";

const generatedHandle = Arbitrary.array(
  Arbitrary.schema(Schema.Literals(["a", "Z", "0", "9", "_"])),
  { maxLength: 10, minLength: 1 }
).pipe(Arbitrary.map((characters) => `fake_${characters.join("")}`));

it.effect.prop(
  "every profile spelling normalizes to the same idempotent URL",
  { handle: generatedHandle },
  ({ handle }) =>
    Effect.gen(function* normalizeForms() {
      const canonical = `https://x.com/${handle.toLowerCase()}`;
      const forms = [handle, `@${handle}`];

      for (const host of [
        "x.com",
        "twitter.com",
        "www.x.com",
        "www.twitter.com",
      ]) {
        for (const protocol of ["", "http://", "https://"]) {
          for (const suffix of ["", "/", "?s=20", "/?s=20", "?s=20#profile"]) {
            forms.push(`${protocol}${host}/${handle}${suffix}`);
          }
        }
      }

      for (const form of forms) {
        const decoded = yield* Schema.decodeUnknownEffect(ApplicantX)(form);
        expect(decoded).toBe(canonical);
        expect(yield* Schema.decodeUnknownEffect(ApplicantX)(decoded)).toBe(
          decoded
        );
        expect(yield* Schema.encodeEffect(ApplicantX)(decoded)).toBe(canonical);
      }
    })
);

it.effect.prop(
  "arbitrary strings decode or refuse without defects",
  { input: Arbitrary.schema(Schema.String) },
  ({ input }) =>
    Effect.gen(function* totalDecoder() {
      const exit = yield* Schema.decodeUnknownEffect(ApplicantX)(input).pipe(
        Effect.exit
      );

      if (Exit.isSuccess(exit)) {
        expect(yield* Schema.decodeUnknownEffect(ApplicantX)(exit.value)).toBe(
          exit.value
        );
      } else {
        expect(Cause.hasDies(exit.cause)).toBe(false);
        expect(Cause.hasFails(exit.cause)).toBe(true);
      }
    })
);

it.effect(
  "refuses non-profile paths, hosts and malformed handles with a precise schema error",
  () =>
    Effect.gen(function* refusals() {
      for (const input of [
        "",
        "@",
        "a".repeat(16),
        "fake-name",
        "https://example.test/fake_applicant",
        "https://x.com/fake_applicant/status/123",
        "https://twitter.com/intent/tweet?text=fake",
        "https://x.com/intent",
        "https://x.com/i",
        "https://x.com/home",
        "https://x.com/fake_applicant/../home",
        "https://x.com@evil.example.test/fake_applicant",
        "https://x.com/%66ake_applicant",
        "ftp://x.com/fake_applicant",
        "@faKe_applicant",
        "@fake_ſynthetic",
        "httpſ://x.com/fake_applicant",
      ]) {
        const error = yield* Schema.decodeUnknownEffect(ApplicantX)(input).pipe(
          Effect.flip
        );

        expect(error.message).toContain("Expected an X profile");
      }

      expect(yield* Schema.decodeUnknownEffect(ApplicantX)("@_")).toBe(
        "https://x.com/_"
      );
      expect(
        yield* Schema.decodeUnknownEffect(ApplicantX)(`@${"_".repeat(15)}`)
      ).toBe(`https://x.com/${"_".repeat(15)}`);
    })
);

it.effect.prop(
  "names trim before the nonempty 100-character bound",
  { input: Arbitrary.schema(Schema.String) },
  ({ input }) =>
    Effect.gen(function* names() {
      const trimmed = input.trim();

      const exit = yield* Schema.decodeUnknownEffect(ApplicantName)(input).pipe(
        Effect.exit
      );

      expect(Exit.isSuccess(exit)).toBe(
        trimmed.length > 0 && trimmed.length <= 100
      );

      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBe(trimmed);
      }
    })
);
