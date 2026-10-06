import type { Plan } from "alchemy";
import { Exit, Schema } from "effect";

export const PlanRowSchema = Schema.Struct({
  action: Schema.Literals([
    "create",
    "update",
    "adopted",
    "replace",
    "delete",
    "orphaned",
    "noop",
    "unbind",
    "run",
  ]),
  resource: Schema.NonEmptyString,
});

export const PlanRowsSchema = Schema.Array(PlanRowSchema);

export type PlanRow = typeof PlanRowSchema.Type;

type ResourceNode = Plan.Plan["resources"][string];

type DeletedNode = NonNullable<Plan.Plan["deletions"][string]>;

type ActionNode = Plan.Plan["actions"][string];

type DeletedAction = NonNullable<Plan.Plan["actionDeletions"][string]>;

export interface PlanPolicyValue {
  readonly resources: Readonly<
    Record<
      string,
      Pick<ResourceNode, "action"> & {
        readonly bindings: readonly Pick<
          ResourceNode["bindings"][number],
          "action" | "sid"
        >[];
        readonly resource: { readonly FQN: string };
      }
    >
  >;
  readonly deletions: Readonly<
    Record<
      string,
      | (Pick<DeletedNode, "action"> & {
          readonly bindings: readonly Pick<
            DeletedNode["bindings"][number],
            "action" | "sid"
          >[];
          readonly resource: { readonly FQN: string };
        })
      | undefined
    >
  >;
  readonly actions: Readonly<
    Record<
      string,
      Pick<ActionNode, "action"> & {
        readonly def: Pick<ActionNode["def"], "FQN">;
      }
    >
  >;
  readonly actionDeletions: Readonly<
    Record<
      string,
      | (Pick<DeletedAction, "action"> & {
          readonly def: Pick<DeletedAction["def"], "FQN">;
        })
      | undefined
    >
  >;
}

export const planRows = (plan: PlanPolicyValue): readonly PlanRow[] => {
  const rows: PlanRow[] = [];

  for (const node of [
    ...Object.values(plan.resources),
    ...Object.values(plan.deletions),
  ]) {
    if (node === undefined) {
      continue;
    }

    rows.push({ action: node.action, resource: node.resource.FQN });

    for (const binding of node.bindings) {
      rows.push({
        action: binding.action === "delete" ? "unbind" : binding.action,
        resource: `${node.resource.FQN}#binding:${binding.sid}`,
      });
    }
  }

  for (const node of [
    ...Object.values(plan.actions),
    ...Object.values(plan.actionDeletions),
  ]) {
    if (node !== undefined) {
      rows.push({ action: node.action, resource: node.def.FQN });
    }
  }

  return rows;
};

export class PlanRejected extends Schema.TaggedError<PlanRejected>()(
  "PlanRejected",
  { reason: Schema.String, resources: Schema.Array(Schema.String) }
) {}

export type Classification =
  | { readonly outcome: "pass"; readonly rows: readonly PlanRow[] }
  | { readonly outcome: "unknown" | "fail"; readonly error: PlanRejected };

export const classifyRows = (
  rows: readonly PlanRow[],
  allow: readonly PlanRow[] = [],
  ownerApproved = false
): Classification => {
  const decoded = Schema.decodeExit(PlanRowsSchema)(rows);

  if (
    Exit.isFailure(decoded) ||
    new Set(rows.map((row) => row.resource)).size !== rows.length
  ) {
    return {
      error: new PlanRejected({
        reason: "invalid-or-duplicate-plan-row",
        resources: [],
      }),
      outcome: "unknown",
    };
  }

  const destructive = rows.filter((row) =>
    ["delete", "replace", "orphaned", "unbind"].includes(row.action)
  );

  if (!ownerApproved && destructive.length > 0) {
    return {
      error: new PlanRejected({
        reason: "owner-sign-off-required",
        resources: destructive.map((row) => row.resource),
      }),
      outcome: "fail",
    };
  }

  const refused = rows.filter(
    (row) =>
      row.action !== "update" &&
      row.action !== "noop" &&
      !allow.some(
        (entry) =>
          entry.resource === row.resource && entry.action === row.action
      )
  );

  return refused.length === 0
    ? { outcome: "pass", rows }
    : {
        error: new PlanRejected({
          reason: "explicit-resource-action-approval-required",
          resources: refused.map((row) => row.resource),
        }),
        outcome: "fail",
      };
};

export const classifyPlan = (
  plan: PlanPolicyValue,
  allow: readonly PlanRow[] = [],
  ownerApproved = false
): Classification => classifyRows(planRows(plan), allow, ownerApproved);
