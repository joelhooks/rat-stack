import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { carriesJoinDetails } from "@rat-stack/core/tokenmaxx-help-guide";
import { Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.js";
import { buildHelpGuide, decodeHelpGuide } from "../scripts/tokenmaxx-help.ts";

it.effect("the shipped guide table decodes and carries no join details", () =>
  Effect.gen(function* checkShippedGuide() {
    const { rows } = yield* buildHelpGuide("../..");

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      expect(
        [row.fix, row.symptom, ...row.keywords].some(carriesJoinDetails)
      ).toBe(false);
    }
  }).pipe(Effect.provide(NodeServices.layer))
);

const cleanRow = {
  fix: "Run it again.",
  keywords: ["herdr"],
  steps: [3],
  symptom: "It failed.",
  tested: true,
};

it.effect.prop(
  "a guide row with a Zoom link, meeting ID or passcode fails the build with a fence message naming the row",
  {
    field: Arbitrary.schema(Schema.Literals(["fix", "symptom"])),
    leak: Arbitrary.schema(
      Schema.Literals([
        "https://us06web.zoom.us/j/81234567890?pwd=abc",
        "Meeting ID: 812 3456 7890",
        "Passcode: 424242",
      ])
    ),
    position: Arbitrary.schema(
      Schema.Int.check(Schema.isBetween({ maximum: 4, minimum: 0 }))
    ),
  },
  ({ field, leak, position }) =>
    Effect.gen(function* checkJoinFence() {
      const rows = Array.from({ length: 5 }, (_, index) =>
        index === position ? { ...cleanRow, [field]: `See ${leak}` } : cleanRow
      );

      const failure = yield* decodeHelpGuide({ rows }).pipe(Effect.flip);

      const parsed = fenceMessage(
        failure.message.split(": ").slice(1).join(": ")
      );

      expect(parsed?.what).toBe(
        `Help guide rows ${String(position)} carry workshop join details.`
      );
    })
);
