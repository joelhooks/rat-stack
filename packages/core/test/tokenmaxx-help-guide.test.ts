import { describe, expect, it } from "@effect/vitest";
import { Option, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { GuideRow, guidanceFor } from "../src/tokenmaxx-help-guide.js";
import { noise } from "./fixtures/help-secrets.js";

const step = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 7, minimum: 1 }))
);

const keyword = Arbitrary.schema(
  Schema.Literals([
    "git: command not found",
    "herdr-app",
    "/login",
    "trust prompt",
    "wrapped",
  ])
);

const row = Arbitrary.all({
  first: step,
  keywords: Arbitrary.array(keyword, { maxLength: 2 }),
  rest: Arbitrary.array(step, { maxLength: 2 }),
}).pipe(
  Arbitrary.map(({ first, keywords, rest }) => ({
    fix: `Fix ${keywords.join(" ")}`,
    keywords,
    steps: [first, ...rest] as const,
    symptom: `Symptom for ${[first, ...rest].join(",")}`,
    tested: keywords.length % 2 === 0,
  }))
);

const mentions = (text: string, words: readonly string[]) =>
  words.some((word) => text.toLowerCase().includes(word.toLowerCase()));

describe("Tokenmaxx help guide", () => {
  it.prop(
    "guidance holds exactly the reported step's rows that are general or name something in the report",
    {
      before: noise,
      mentioned: Arbitrary.array(keyword, { maxLength: 2 }),
      reported: step,
      rows: Arbitrary.array(row, { maxLength: 8 }),
      shout: Arbitrary.schema(Schema.Boolean),
    },
    ({ before, mentioned, reported, rows, shout }) => {
      const said = `${before} ${mentioned.join(" and ")} happened`;
      const text = shout ? said.toUpperCase() : said;

      expect(guidanceFor(rows, reported, text)).toStrictEqual(
        rows
          .filter(
            (candidate) =>
              candidate.steps.includes(reported) &&
              (candidate.keywords.length === 0 ||
                mentions(said, candidate.keywords))
          )
          .map(({ fix, steps, symptom, tested }) => ({
            fix,
            steps,
            symptom,
            tested,
          }))
      );
    }
  );

  it.prop(
    "a guide row carrying a Zoom link, meeting ID or passcode never decodes",
    {
      detail: Arbitrary.all({
        digits: Arbitrary.schema(
          Schema.String.check(Schema.isPattern(/^\d{3} \d{4} \d{4}$/u))
        ),
        kind: Arbitrary.schema(
          Schema.Literals([
            "link",
            "vanityLink",
            "meetingId",
            "shortMeetingId",
            "passcode",
            "pwd",
            "number",
          ])
        ),
        shortId: Arbitrary.schema(
          Schema.String.check(Schema.isPattern(/^\d{3} \d{3} \d{3}$/u))
        ),
      }),
      field: Arbitrary.schema(Schema.Literals(["fix", "symptom", "keyword"])),
    },
    ({ detail, field }) => {
      const leak = {
        link: `https://us06web.zoom.us/j/${detail.digits.replaceAll(" ", "")}`,
        meetingId: `Meeting ID: ${detail.digits}`,
        number: `join with ${detail.digits}`,
        passcode: "Passcode: rat123",
        pwd: "https://example.test/j/1?pwd=abc",
        shortMeetingId: `Meeting ID ${detail.shortId}`,
        vanityLink: "https://zoom.us/my/ratstack",
      }[detail.kind];

      const candidate = {
        fix: field === "fix" ? `Join here: ${leak}` : "Run it again.",
        keywords: field === "keyword" ? [leak] : ["herdr"],
        steps: [3],
        symptom: field === "symptom" ? `Stuck at ${leak}` : "It failed.",
        tested: true,
      };

      expect(
        Option.isNone(Schema.decodeUnknownOption(GuideRow)(candidate))
      ).toBe(true);
    }
  );
});
