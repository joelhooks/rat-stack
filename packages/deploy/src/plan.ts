import { stripVTControlCharacters } from "node:util";

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
  ]),
  resource: Schema.NonEmptyString,
});

export type PlanRow = typeof PlanRowSchema.Type;

export class PlanRejected extends Schema.TaggedError<PlanRejected>()(
  "PlanRejected",
  {
    reason: Schema.String,
    resources: Schema.Array(Schema.String),
  }
) {}

export type Classification =
  | { readonly outcome: "pass"; readonly rows: readonly PlanRow[] }
  | { readonly outcome: "unknown" | "fail"; readonly error: PlanRejected };

export const classifyPlan = (
  output: string,
  allow: readonly PlanRow[] = []
): Classification => {
  const lines = stripVTControlCharacters(output).trim().split("\n");

  if (
    lines[0] === undefined ||
    !/^Plan: (?:no resources|no changes|(?:[0-9]+ to (?:create|update|adopted|replace|delete|orphaned|noop|unbind)|[0-9]+ binding changes|[0-9]+ tasks)(?:, (?:[0-9]+ to (?:create|update|adopted|replace|delete|orphaned|noop|unbind)|[0-9]+ binding changes|[0-9]+ tasks))*)$/u.test(
      lines[0]
    )
  ) {
    return {
      error: new PlanRejected({ reason: "missing-plan-header", resources: [] }),
      outcome: "unknown",
    };
  }

  const rows: PlanRow[] = [];
  const seen = new Set<string>();

  for (const line of lines.slice(1)) {
    const match =
      /^\[(?<resource>[^\]\r\n]+)\] (?<action>create|update|adopted|replace|delete|orphaned|noop|unbind)$/u.exec(
        line
      );

    if (
      match === null ||
      match.groups?.resource === undefined ||
      match.groups?.action === undefined ||
      seen.has(match.groups?.resource)
    ) {
      return {
        error: new PlanRejected({
          reason: "unrecognized-or-duplicate-plan-row",
          resources: [],
        }),
        outcome: "unknown",
      };
    }

    const parsed = Schema.decodeUnknownExit(PlanRowSchema)({
      action: match.groups?.action,
      resource: match.groups?.resource,
    });

    if (Exit.isFailure(parsed)) {
      return {
        error: new PlanRejected({ reason: "invalid-plan-row", resources: [] }),
        outcome: "unknown",
      };
    }

    seen.add(parsed.value.resource);
    rows.push(parsed.value);
  }

  if (
    rows.length === 0 &&
    lines[0] !== "Plan: no resources" &&
    lines[0] !== "Plan: no changes"
  ) {
    return {
      error: new PlanRejected({ reason: "missing-plan-rows", resources: [] }),
      outcome: "unknown",
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
