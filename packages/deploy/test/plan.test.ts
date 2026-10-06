import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import { classifyPlan, planRows, PlanRowSchema } from "../src/plan.js";
import type { PlanPolicyValue, PlanRow } from "../src/plan.js";

const Generated = Schema.Struct({
  action: PlanRowSchema.fields.action,
  approved: Schema.Boolean,
});

const generatedRows = Arbitrary.array(Arbitrary.schema(Generated), {
  maxLength: 30,
});

const policyPlan = (rows: readonly PlanRow[]): PlanPolicyValue => {
  const plan: PlanPolicyValue = {
    actionDeletions: {},
    actions: {},
    deletions: {},
    resources: {},
  };

  const resources: Record<string, PlanPolicyValue["resources"][string]> = {};
  const deletions: Record<string, PlanPolicyValue["deletions"][string]> = {};
  const actions: Record<string, PlanPolicyValue["actions"][string]> = {};

  const actionDeletions: Record<
    string,
    PlanPolicyValue["actionDeletions"][string]
  > = {};

  for (const row of rows) {
    if (row.action === "delete" || row.action === "orphaned") {
      deletions[row.resource] = {
        action: row.action,
        bindings: [],
        resource: { FQN: row.resource },
      };
    } else if (row.action === "run") {
      actions[row.resource] = { action: "run", def: { FQN: row.resource } };
    } else if (row.action === "unbind") {
      resources[row.resource] = {
        action: "update",
        bindings: [{ action: "delete", sid: "removed" }],
        resource: { FQN: row.resource },
      };
    } else {
      resources[row.resource] = {
        action: row.action,
        bindings: [],
        resource: { FQN: row.resource },
      };
    }
  }

  return { ...plan, actionDeletions, actions, deletions, resources };
};

const destructive = (action: PlanRow["action"]) =>
  ["delete", "replace", "orphaned", "unbind"].includes(action);

const approvalRow = (row: PlanRow): PlanRow =>
  row.action === "unbind"
    ? { ...row, resource: `${row.resource}#binding:removed` }
    : row;

describe("native plan policy", () => {
  it.prop(
    "every unsafe action needs an exact allow entry, and destructive actions need separate owner sign-off",
    { generated: generatedRows, ownerApproved: Schema.Boolean },
    ({ generated, ownerApproved }) => {
      const rows: readonly PlanRow[] = generated.map((row, index) => ({
        action: row.action,
        resource: `Resource${index}`,
      }));

      const allow = rows.flatMap((row, index) =>
        generated[index]?.approved === true ? [approvalRow(row)] : []
      );

      const safe = generated.every(
        (row) =>
          row.action === "update" ||
          row.action === "noop" ||
          (row.approved && (!destructive(row.action) || ownerApproved))
      );

      expect(classifyPlan(policyPlan(rows), allow, ownerApproved).outcome).toBe(
        safe ? "pass" : "fail"
      );
      expect(
        classifyPlan(policyPlan(rows), rows.map(approvalRow), true).outcome
      ).toBe("pass");
      expect(
        classifyPlan(policyPlan(rows), rows.map(approvalRow)).outcome
      ).toBe(rows.some((row) => destructive(row.action)) ? "fail" : "pass");
    },
    { arbitrary: { runs: 300 } }
  );

  it.prop(
    "neither the right action on another resource nor another action on the right resource grants permission",
    { action: PlanRowSchema.fields.action },
    ({ action }) => {
      const row = { action, resource: "Resource" };
      const safe = action === "update" || action === "noop";
      expect(
        classifyPlan(policyPlan([row]), [{ action, resource: "Other" }], true)
          .outcome
      ).toBe(safe ? "pass" : "fail");
      expect(
        classifyPlan(
          policyPlan([row]),
          [
            {
              action: action === "create" ? "delete" : "create",
              resource: approvalRow(row).resource,
            },
          ],
          true
        ).outcome
      ).toBe(safe ? "pass" : "fail");
    },
    { arbitrary: { runs: 100 } }
  );

  it.prop(
    "action-state deletions and bindings are included, even when the parent resource is a noop",
    { action: Schema.Literals(["create", "update", "delete", "noop"]) },
    ({ action }) => {
      const plan: PlanPolicyValue = {
        actionDeletions: {
          Task: { action: "delete", def: { FQN: "Task" } },
          missing: undefined,
        },
        actions: {},
        deletions: { missing: undefined },
        resources: {
          Resource: {
            action: "noop",
            bindings: [{ action, sid: "binding" }],
            resource: { FQN: "Resource" },
          },
        },
      };

      const rows = planRows(plan);
      expect(rows).toContainEqual({
        action: action === "delete" ? "unbind" : action,
        resource: "Resource#binding:binding",
      });
      expect(rows).toContainEqual({ action: "delete", resource: "Task" });
      expect(classifyPlan(plan, rows).outcome).toBe("fail");
      expect(classifyPlan(plan, rows, true).outcome).toBe("pass");
    },
    { arbitrary: { runs: 100 } }
  );

  it("refuses duplicate identities across resources and actions", () => {
    expect(
      classifyPlan({
        actionDeletions: {},
        actions: { One: { action: "noop", def: { FQN: "One" } } },
        deletions: {},
        resources: {
          One: { action: "noop", bindings: [], resource: { FQN: "One" } },
        },
      }).outcome
    ).toBe("unknown");
  });
});
