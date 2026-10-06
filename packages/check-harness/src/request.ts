import { Schema } from "effect";

export const CheckRequestSchema = Schema.Struct({
  attempt: Schema.Natural.check(Schema.isGreaterThanOrEqualTo(1)),
  candidateVersions: Schema.Record(
    Schema.NonEmptyString,
    Schema.NonEmptyString
  ).check(Schema.isMinProperties(1)),
  deploymentGeneration: Schema.Natural,
  head: Schema.String.check(Schema.isPattern(/^[a-f0-9]{40}$/u)),
  runId: Schema.NonEmptyString,
  window: Schema.Struct({ from: Schema.Natural, through: Schema.Natural }),
});

export type CheckRequest = typeof CheckRequestSchema.Type;

export const sameRequest = (expected: CheckRequest, actual: CheckRequest) => {
  const keys = Object.keys(expected.candidateVersions);

  return (
    expected.attempt === actual.attempt &&
    expected.deploymentGeneration === actual.deploymentGeneration &&
    expected.head === actual.head &&
    expected.runId === actual.runId &&
    expected.window.from === actual.window.from &&
    expected.window.through === actual.window.through &&
    expected.window.from <= expected.window.through &&
    keys.length === Object.keys(actual.candidateVersions).length &&
    keys.every(
      (key) => expected.candidateVersions[key] === actual.candidateVersions[key]
    )
  );
};
