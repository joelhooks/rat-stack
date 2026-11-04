import {
  FlagChangeSchema,
  FlagExit,
  FlagFlipRefused,
  FlagKill,
  FlagScopeMismatch,
  FlagThreshold,
  FlipFlagInput,
  ListFlagChangesInput,
  RecordFlagEvidenceInput,
} from "@rat-stack/core/flag-control";
import {
  FlagStorageError,
  InvalidFlagValue,
  UnknownFlag,
  defineFlag,
} from "@rat-stack/core/flags";
import type { Flag } from "@rat-stack/core/flags";
import { Schema } from "effect";

const tenantScope = Schema.Union([
  Schema.Literal("global"),
  Schema.Struct({ tenant: Schema.NonEmptyString }),
]);

const checked = FlagExit.cases.evidence.make({
  requirements: [
    {
      event: "check",
      read: "acceptance report",
      threshold: FlagThreshold.cases["at-least"].make({ count: 1 }),
    },
  ],
});

export const ladderRungs = ["off", "canary", "on"] as const;

const ladder = <A>(values: readonly [A, A, A]) =>
  [
    {
      authority: "agent",
      exit: checked,
      name: ladderRungs[0],
      value: values[0],
    },
    {
      authority: "agent",
      exit: checked,
      name: ladderRungs[1],
      value: values[1],
    },
    {
      authority: "agent",
      exit: FlagExit.cases.final.make({}),
      name: ladderRungs[2],
      value: values[2],
    },
  ] as const;

export const ladderFlag = defineFlag("LEDGER_LADDER", Schema.String, {
  default: "off",
  kill: FlagKill.cases["previous-rung"].make({}),
  owner: "tests",
  purpose: "Exercise the Durable Object ledger.",
  readScope: tenantScope,
  removeBy: "2099-01-01",
  rungs: ladder(["off", "canary", "on"]),
});

export const deployFlag = defineFlag("LEDGER_DEPLOY", Schema.Boolean, {
  default: false,
  owner: "tests",
  purpose: "Exercise deployment-only refusals.",
  removeBy: "2099-01-01",
  rungs: [
    { authority: "agent", exit: checked, name: "off", value: false },
    {
      authority: "agent",
      exit: FlagExit.cases.final.make({}),
      name: "on",
      value: true,
    },
  ],
});

export const refusedReadFlag = defineFlag("READ_REFUSED", Schema.String, {
  default: "declared",
  failurePolicy: "refuse",
  owner: "tests",
  purpose: "Exercise refused replica reads.",
  readScope: tenantScope,
  removeBy: "2099-01-01",
  rungs: ladder(["declared", "middle", "final"]),
});

export const defaultedReadFlag = defineFlag("READ_DEFAULTED", Schema.String, {
  default: "declared",
  owner: "tests",
  purpose: "Exercise catalog-default replica reads.",
  readScope: tenantScope,
  removeBy: "2099-01-01",
  rungs: ladder(["declared", "middle", "final"]),
});

export const ledgerRegistry: readonly Flag<unknown>[] = [
  ladderFlag,
  deployFlag,
];

export const readRegistry: readonly Flag<unknown>[] = [
  refusedReadFlag,
  defaultedReadFlag,
  deployFlag,
];

export const configuredValues = {
  [defaultedReadFlag.name]: "configured",
  [deployFlag.name]: "true",
  [refusedReadFlag.name]: "configured",
};

const optionalScope = Schema.optional(Schema.Json);

const optionalActor = Schema.optional(Schema.String);

export const LedgerCommand = Schema.TaggedUnion({
  DirectList: { input: ListFlagChangesInput, partition: Schema.String },
  DirectRead: {
    name: Schema.String,
    partition: Schema.String,
    scope: optionalScope,
  },
  Evidence: { actor: optionalActor, input: RecordFlagEvidenceInput },
  Flip: { actor: optionalActor, input: FlipFlagInput },
  Get: { name: Schema.String, scope: optionalScope },
  KvGet: { key: Schema.String },
  KvPut: { key: Schema.String, value: Schema.String },
  List: { input: ListFlagChangesInput },
  Read: { name: Schema.String, scope: optionalScope },
  Record: { change: FlagChangeSchema },
  Redrive: { partition: Schema.String },
  Registry: {},
});

export const LedgerFailure = Schema.Union([
  FlagStorageError,
  FlagScopeMismatch,
  FlagFlipRefused,
  InvalidFlagValue,
  UnknownFlag,
]);

export const LedgerOutcome = Schema.TaggedUnion({
  Defect: {},
  Failure: { error: LedgerFailure },
  Success: { value: Schema.Json },
  Unexpected: { tag: Schema.String },
});
