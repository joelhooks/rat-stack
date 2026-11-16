import { Schema } from "effect";

import { SetupStep } from "./tokenmaxx-help-contracts.js";
import type { GuideEntry } from "./tokenmaxx-help-contracts.js";

const joinDetails = [
  /zoom\.(?:us|com)\b/iu,
  /\bmeeting\s*(?:id|number)\b/iu,
  /\bpass\s*code\b/iu,
  /[?&]pwd=/iu,
  /\b\d{3}[\s-]?\d{3,4}[\s-]?\d{4}\b/u,
];

export const carriesJoinDetails = (text: string) =>
  joinDetails.some((pattern) => pattern.test(text));

const PlainText = Schema.NonEmptyString.check(
  Schema.makeFilter(
    (text: string) =>
      !carriesJoinDetails(text) ||
      "This text carries workshop join details: a Zoom link, a meeting ID, or a passcode. Join details go out only in the workshop email."
  )
);

export const GuideRow = Schema.Struct({
  fix: PlainText,
  keywords: Schema.Array(PlainText),
  steps: Schema.NonEmptyArray(SetupStep),
  symptom: PlainText,
  tested: Schema.Boolean,
});

export const GuideTable = Schema.Struct({
  rows: Schema.Array(GuideRow),
});

const escaped = (keyword: string) =>
  keyword.replaceAll(/[$()*+.?[\\\]^{|}]/gu, String.raw`\$&`);

const mentions = (text: string, keyword: string) =>
  new RegExp(
    String.raw`(?<![a-z0-9])${escaped(keyword.toLowerCase())}(?![a-z0-9])`,
    "u"
  ).test(text);

export const guidanceFor = (
  rows: readonly (typeof GuideRow.Type)[],
  step: number,
  text: string
): readonly (typeof GuideEntry.Type)[] => {
  const lowered = text.toLowerCase();

  return rows.flatMap(({ fix, keywords, steps, symptom, tested }) =>
    steps.includes(step) &&
    (keywords.length === 0 ||
      keywords.some((keyword) => mentions(lowered, keyword)))
      ? [{ fix, steps, symptom, tested }]
      : []
  );
};
