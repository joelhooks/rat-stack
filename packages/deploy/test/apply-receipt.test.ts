import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { summarizeApply } from "../src/apply-receipt.js";

it.prop(
  "failed native apply preserves completed resources and identifies every unfinished one",
  {
    retained: Schema.Boolean,
    settled: Arbitrary.array(Arbitrary.schema(Schema.Boolean), {
      maxLength: 30,
    }),
    termination: Schema.Literals(["success", "failed", "crashed"]),
  },
  ({ settled, termination, retained }) => {
    const intended = settled.map((_, index) => `Resource${index}`);
    const completed = intended.filter((_, index) => settled[index] === true);

    const result = summarizeApply(
      intended,
      [...completed, ...completed],
      termination,
      retained ? completed : []
    );

    expect(result.retainedOrphans).toStrictEqual(retained ? completed : []);

    expect(result.updated).toStrictEqual(completed);
    expect(result.notUpdated).toStrictEqual(
      intended.filter((_, index) => settled[index] !== true)
    );
    expect(new Set([...result.updated, ...result.notUpdated]).size).toBe(
      intended.length
    );

    if (termination !== "success" && completed.length > 0) {
      expect(result.outcome).toBe("partial");
    }

    if (termination === "success" && settled.every(Boolean)) {
      expect(result.outcome).toBe("applied");
    }

    if (termination !== "success" && completed.length === 0) {
      expect(result.outcome).toBe(termination);
    }
  },
  { arbitrary: { runs: 300 } }
);
