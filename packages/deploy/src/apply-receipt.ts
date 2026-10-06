import type { ApplyReceipt } from "./contracts.js";

export const summarizeApply = (
  intended: readonly string[],
  completed: readonly string[],
  termination: "success" | "failed" | "crashed",
  retainedOrphans: readonly string[] = []
): ApplyReceipt => {
  const updated = [...new Set(completed)];

  const notUpdated = [...new Set(intended)].filter(
    (resource) => !updated.includes(resource)
  );

  if (termination === "success") {
    return {
      notUpdated,
      outcome: notUpdated.length === 0 ? "applied" : "partial",
      retainedOrphans,
      updated,
      versions: {},
    };
  }

  return {
    notUpdated,
    outcome: updated.length > 0 ? "partial" : termination,
    retainedOrphans,
    updated,
    versions: {},
  };
};
