import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { classifyPlan, PlanRowSchema } from "../src/plan.js";

const Resource = Schema.String.check(
  Schema.isPattern(/^[A-Za-z][A-Za-z0-9/_-]{0,40}$/u)
);

const GeneratedRow = Schema.Struct({
  action: PlanRowSchema.fields.action,
  resource: Resource,
});

describe("plan safety", () => {
  it.prop(
    "only exact resource-action approval permits a non-update action",
    { other: GeneratedRow, row: GeneratedRow },
    ({ row, other }) => {
      const text = `Plan: 1 to ${row.action}\n[${row.resource}] ${row.action}`;
      const safe = row.action === "update" || row.action === "noop";
      expect(classifyPlan(text).outcome).toBe(safe ? "pass" : "fail");
      expect(classifyPlan(text, [row]).outcome).toBe("pass");
      expect(classifyPlan(text, [other]).outcome).toBe(
        safe || (row.resource === other.resource && row.action === other.action)
          ? "pass"
          : "fail"
      );
    },
    { arbitrary: { runs: 300 } }
  );

  it.prop(
    "unknown action text cannot be approved",
    { action: Schema.String, resource: Resource },
    ({ resource, action }) => {
      if (
        [
          "create",
          "update",
          "adopted",
          "replace",
          "delete",
          "orphaned",
          "noop",
          "unbind",
        ].includes(action)
      ) {
        return;
      }

      expect(
        classifyPlan(`Plan: 1 to update\n[${resource}] ${action}`).outcome
      ).toBe("unknown");
    },
    { arbitrary: { runs: 300 } }
  );

  it.prop(
    "truncated, duplicate and injected rows cannot clear the gate",
    { row: GeneratedRow },
    ({ row }) => {
      const text = `Plan: 1 to ${row.action}\n[${row.resource}] ${row.action}`;

      for (const broken of [
        text.split("\n")[0] ?? "",
        `${text}\n[${row.resource}] ${row.action}`,
        `${text}\nfailed to finish plan`,
        "",
      ]) {
        expect(classifyPlan(broken, [row]).outcome).not.toBe("pass");
      }
    },
    { arbitrary: { runs: 300 } }
  );
});
