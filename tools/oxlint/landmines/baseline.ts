import { Schema } from "effect";

import { Budget as BudgetSchema, readBudget } from "./finding.ts";

const RepoPath = Schema.String.check(
  Schema.isPattern(/^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[\w.-]+(?:\/[\w.-]+)*$/u)
);
const Reason = Schema.String.check(Schema.isPattern(/^\S[^\r\n]*\S$/u));
const BaselineEntry = Schema.Struct({ budget: BudgetSchema, reason: Reason });
const Baseline = Schema.Record(RepoPath, Schema.NonEmptyArray(BaselineEntry));

export type Baseline = typeof Baseline.Type;
export type Budget = typeof BudgetSchema.Type;
export const readBaseline = Schema.decodeUnknownSync(
  Schema.fromJsonString(Baseline)
);

const Diagnostic = Schema.Struct({
  code: Schema.optionalKey(Schema.NullOr(Schema.String)),
  severity: Schema.String,
  message: Schema.String,
  filename: Schema.optionalKey(RepoPath),
});
const decodeLint = Schema.decodeUnknownSync(
  Schema.fromJsonString(
    Schema.Struct({ diagnostics: Schema.Array(Diagnostic) })
  )
);
export const budgetRuleIds = [
  "no-fixed-sleep",
  "no-flake-masking-timeout",
  "no-test-doubles",
] as const;
const budgetRules = new Set(budgetRuleIds.map((id) => `landmines(${id})`));

export function budgetFindings(output: string) {
  const observed = new Map<string, Budget[]>();
  for (const { code, filename, message, severity } of decodeLint(output)
    .diagnostics) {
    if (
      !code ||
      !budgetRules.has(code) ||
      !filename ||
      severity !== "warning"
    ) {
      throw new Error(
        `Unexpected Oxlint diagnostic (${code ?? "no rule"}): ${message}. The budget check needs only Landmines warnings. Fix: inspect \`packages/core/scripts/check-landmines.ts\`.`
      );
    }
    const items = observed.get(filename) ?? [];
    items.push(readBudget(message));
    observed.set(filename, items);
  }
  return observed;
}

const sameBudget = (left: Budget, right: Budget) =>
  JSON.stringify(left) === JSON.stringify(right);
const budgetsIn = (entries: readonly (typeof BaselineEntry.Type)[]) =>
  entries.map(({ budget }) => budget);

function subtract<A, B>(
  left: readonly A[],
  right: readonly B[],
  matches: (left: A, right: B) => boolean
) {
  const unmatched = [...right];
  return left.filter((item) => {
    const match = unmatched.findIndex((candidate) => matches(item, candidate));
    if (match < 0) {
      return true;
    }
    unmatched.splice(match, 1);
    return false;
  });
}

const baselinePath = "`tools/oxlint/landmines/baseline.json`";

export function baselineDrift(
  baseline: Baseline,
  observed: ReadonlyMap<string, readonly Budget[]>
) {
  const paths = new Set([...Object.keys(baseline), ...observed.keys()]);
  return [...paths].toSorted().flatMap((path) => {
    const recorded = budgetsIn(baseline[path] ?? []);
    const actual = observed.get(path) ?? [];
    return [
      ...subtract(actual, recorded, sameBudget).map(
        (budget) =>
          `${path} reports an unrecorded budget ${JSON.stringify(budget)}. A new or changed budget needs a reason. Fix: remove it or add an entry with what it waits for to ${baselinePath}.`
      ),
      ...subtract(recorded, actual, sameBudget).map(
        (budget) =>
          `${path} no longer reports budget ${JSON.stringify(budget)}. Keeping its entry would let the budget return unnoticed. Fix: remove the stale entry from ${baselinePath}.`
      ),
    ];
  });
}

export function growthWithoutReason(base: Baseline, current: Baseline) {
  return Object.entries(current).flatMap(([path, entries]) => {
    const prior = base[path] ?? [];
    const added = subtract(entries, prior, (left, right) =>
      sameBudget(left.budget, right.budget)
    );
    return added.flatMap(({ budget, reason }) =>
      prior.some((entry) => entry.reason === reason)
        ? [
            `${path} reuses a base reason for a new budget ${JSON.stringify(budget)}. A new or changed budget needs its own rationale. Fix: explain what this budget waits for in ${baselinePath}.`,
          ]
        : []
    );
  });
}
