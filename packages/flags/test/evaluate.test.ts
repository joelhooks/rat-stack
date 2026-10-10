import { expect, it } from "@effect/vitest";
import { defineFlag } from "@rat-stack/core/flags";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { evaluateFlag } from "../src/evaluate.js";

const flag = defineFlag("test-rollout", Schema.Boolean, {
  default: false,
  owner: "tests",
  removeBy: "2099-01-01",
});

const subject = Arbitrary.schema(Schema.NonEmptyString);

const percentage = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 0 }))
);

it.prop(
  "evaluation is deterministic across unrelated evaluations",
  { percentage, subject },
  ({ subject: id, percentage: share }) => {
    const rules = [{ percentage: share, value: true }];
    const before = evaluateFlag(flag, { subject: id }, rules);
    evaluateFlag(flag, { subject: `${id}:other` }, rules);
    expect(evaluateFlag(flag, { subject: id }, rules)).toBe(before);
  }
);

it.prop(
  "subjects stay sticky when the rollout grows",
  { larger: percentage, percentage, subject },
  ({ subject: id, percentage: first, larger }) => {
    const small = Math.min(first, larger);
    const large = Math.max(first, larger);

    const enrolled = evaluateFlag(flag, { subject: id }, [
      { percentage: small, value: true },
    ]);

    if (enrolled) {
      expect(
        evaluateFlag(flag, { subject: id }, [
          { percentage: large, value: true },
        ])
      ).toBe(true);
    }
  }
);

it.prop(
  "observed rollout share stays within six percentage points",
  {
    percentage,
    population: Schema.NonEmptyString,
  },
  ({ population, percentage: share }) => {
    const subjects = Array.from(
      { length: 4096 },
      (_, index) => `${population}:${index}`
    );

    const rules = [{ percentage: share, value: true }];

    const enabled = subjects.filter((id) =>
      evaluateFlag(flag, { subject: id }, rules)
    ).length;

    expect(
      Math.abs((enabled / subjects.length) * 100 - share)
    ).toBeLessThanOrEqual(6);
  },
  { arbitrary: { runs: 20 } }
);

it.prop(
  "a flag without rules returns its declared default",
  { subject, value: Schema.Boolean },
  ({ value, subject: id }) => {
    const declared = defineFlag("default", Schema.Boolean, {
      default: value,
      owner: "tests",
      removeBy: "2099-01-01",
    });

    expect(evaluateFlag(declared, { subject: id }, [])).toBe(value);
  }
);

it.prop(
  "allow-lists select variants and missing subjects retain defaults",
  { subject },
  ({ subject: id }) => {
    const variant = defineFlag(
      "variant",
      Schema.Literals(["daily", "persistent"]),
      { default: "daily", owner: "tests", removeBy: "2099-01-01" }
    );

    const rules = [{ subjects: [id], value: "persistent" as const }];
    expect(evaluateFlag(variant, { subject: id }, rules)).toBe("persistent");
    expect(evaluateFlag(variant, {}, rules)).toBe("daily");
  }
);
