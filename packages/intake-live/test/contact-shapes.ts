import { Schema } from "effect";
import { Arbitrary } from "effect/unstable/arbitrary";

export const contactFragments = [
  "joel@example.com",
  "a.b+tag@mail.co.uk",
  "someone＠example.org",
  "me%40example.com",
  "root@localhost",
  "someone＠box",
  "me%40mail",
  "https://example.com/path?q=1",
  "http://localhost:3000",
  "www.example.net",
  "example.dev/page",
  "joel.dev",
  "+1 (555) 123-4567",
  "555.123.4567",
  "+44 20 7946 0958",
  "5551234567",
] as const;

export const plainFragments = [
  "building",
  "an agent harness",
  "for",
  "3 teams",
  "in 2026",
  "e.g.",
  "TypeScript",
  "i.e.",
  "12 people",
  "",
  "evals",
] as const;

const Fragment = Schema.Union([
  Schema.Literals(contactFragments),
  Schema.Literals(plainFragments),
]);

const Separator = Schema.Literals([" ", "  ", "\n", " - ", ", "]);

export const answerText = Arbitrary.array(
  Arbitrary.schema(Schema.Tuple([Fragment, Separator])),
  { maxLength: 30 }
).pipe(
  Arbitrary.map((parts) =>
    parts.map(([fragment, separator]) => `${fragment}${separator}`).join("")
  )
);

const separatedDigitRuns = (text: string) => text.match(/[\d\s().+-]+/gu) ?? [];

const digitCount = (run: string) => run.replaceAll(/\D/gu, "").length;

export const leaksContact = (text: string) =>
  /@|＠|%40/iu.test(text) ||
  /:\/\/|www\./iu.test(text) ||
  /[\p{L}\p{N}-]\.\p{L}{2,}/u.test(text) ||
  separatedDigitRuns(text).some((run) => digitCount(run) >= 7);
