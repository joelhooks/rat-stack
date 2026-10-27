import { Effect, Schema } from "effect";

import { FlagScopeMismatch } from "./flag-scope-mismatch.js";

export { FlagScopeMismatch } from "./flag-scope-mismatch.js";

export { FlagFlipRefused } from "./flag-flip-refused.js";

export const FlagAuthority = Schema.Literals(["agent", "arbiter", "owner"]);

export type FlagAuthorityRole = typeof FlagAuthority.Type;

export const FlagThreshold = Schema.TaggedUnion({
  "at-least": { count: Schema.Finite },
  "at-most": { count: Schema.Finite },
});

export const FlagRequirement = Schema.Struct({
  event: Schema.NonEmptyString,
  read: Schema.NonEmptyString,
  threshold: FlagThreshold,
});

export const FlagExit = Schema.TaggedUnion({
  evidence: { requirements: Schema.NonEmptyArray(FlagRequirement) },
  final: {},
});

export const FlagKill = Schema.TaggedUnion({
  default: {},
  none: { reason: Schema.NonEmptyString },
  "previous-rung": {},
});

export const flagRungSchema = <A>(value: Schema.ConstraintDecoder<A>) =>
  Schema.Struct({
    authority: FlagAuthority,
    exit: FlagExit,
    name: Schema.NonEmptyString,
    value,
  });

export interface FlagRung<A> {
  readonly authority: FlagAuthorityRole;
  readonly exit: typeof FlagExit.Type;
  readonly name: string;
  readonly value: A;
}

export const FlagScope = Schema.Json;

export const GlobalFlagScope = Schema.Literal("global");

export const FlagTarget = Schema.TaggedUnion({
  off: {},
  rung: { name: Schema.NonEmptyString },
});

export const FlipFlagInput = Schema.Struct({
  approvalRef: Schema.optionalKey(Schema.NonEmptyString),
  authority: FlagAuthority,
  name: Schema.NonEmptyString,
  reason: Schema.NonEmptyString,
  scope: Schema.optionalKey(FlagScope),
  target: FlagTarget,
});

export const RecordFlagEvidenceInput = Schema.Struct({
  event: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  observed: Schema.Finite,
  read: Schema.NonEmptyString,
  ref: Schema.NonEmptyString,
  rung: Schema.NonEmptyString,
  scope: Schema.optionalKey(FlagScope),
});

export const FlagEvidence = Schema.Struct({
  ...RecordFlagEvidenceInput.fields,
  recordedAt: Schema.Int,
  recordedBy: Schema.String,
});

export const FlagReceipt = Schema.Struct({
  actor: Schema.String,
  approvalRef: Schema.NullOr(Schema.String),
  authority: FlagAuthority,
  evidenceRefs: Schema.Array(Schema.String),
  from: Schema.String,
  name: Schema.String,
  reason: Schema.NonEmptyString,
  revision: Schema.Int,
  scope: FlagScope,
  to: Schema.String,
  value: Schema.Json,
});

export const FlagPosition = Schema.Struct({
  evidence: Schema.Array(FlagEvidence),
  receipt: Schema.optionalKey(FlagReceipt),
  revision: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  rung: Schema.String,
  value: Schema.Json,
});

const FlagScopeRecord = Schema.Record(Schema.String, Schema.Json);

export const scopeKey = (value: typeof FlagScope.Type): string => {
  if (Array.isArray(value)) {
    return `[${value.map(scopeKey).join(",")}]`;
  }

  if (Schema.is(FlagScopeRecord)(value)) {
    return `{${Object.entries(value)
      .toSorted(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${scopeKey(entry)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
};

export const flagPartition = (name: string, scope: typeof FlagScope.Type) =>
  `${encodeURIComponent(name)}/${encodeURIComponent(scopeKey(scope))}`;

export const validateFlagScope = (
  flag: {
    readonly name: string;
    readonly readScope: Schema.ConstraintDecoder<typeof FlagScope.Type>;
  },
  scope: typeof FlagScope.Type = "global"
) => {
  const mismatch = () =>
    new FlagScopeMismatch({
      flag: flag.name,
      repair: `Supply an exact scope accepted by ${flag.name}'s declared readScope schema. Evidence and flips must use that same scope.`,
      scope,
    });

  return Schema.decodeUnknownEffect(flag.readScope, {
    onExcessProperty: "error",
  })(scope).pipe(
    Effect.mapError(mismatch),
    Effect.filterOrFail(
      (decoded) => scopeKey(decoded) === scopeKey(scope),
      mismatch
    )
  );
};
