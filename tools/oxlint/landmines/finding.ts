import { Schema } from "effect";

export const Budget = Schema.Tuple([
  Schema.Literals(["test", "config", "sleep", "double"]),
  Schema.Array(Schema.String),
  Schema.String,
  Schema.String,
]);

const separator = ". Budget: ";
const decodeBudget = Schema.decodeUnknownSync(Schema.fromJsonString(Budget));

export function readBudget(message: string) {
  const start = message.indexOf(separator);
  const end = message.lastIndexOf(". Fix: ");
  if (start < 0 || end < 0) {
    throw new Error(
      "Oxlint did not report a budget signature. The fence cannot compare this finding. Fix: check `tools/oxlint/landmines/finding.ts`."
    );
  }
  return decodeBudget(message.slice(start + separator.length, end));
}

export const budgetMessage = (what: string, why: string, fix: string) =>
  `${what}. ${why}${separator}{{signature}}. Fix: ${fix}.`;
