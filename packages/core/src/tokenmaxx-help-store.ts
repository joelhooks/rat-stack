import { Schema } from "effect";

import { SetupStep } from "./tokenmaxx-help-contracts.js";

export const HELP_RETENTION_MILLIS = 14 * 24 * 60 * 60 * 1000;

export const HELP_REPORTS_PER_ATTENDEE_PER_DAY = 30;

export const HELP_REPORTS_TOTAL = 2000;

export const HELP_DAY_MILLIS = 24 * 60 * 60 * 1000;

export const NewHelpReport = Schema.Struct({
  emailHash: Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u)),
  errorText: Schema.NullOr(Schema.String),
  matched: Schema.Int,
  os: Schema.NullOr(Schema.String),
  redacted: Schema.Boolean,
  reportId: Schema.String.check(Schema.isBetweenLength(1, 64)),
  step: SetupStep,
  symptom: Schema.String,
  test: Schema.Boolean,
});

export const StoredHelpReport = Schema.Struct({
  ...NewHelpReport.fields,
  answer: Schema.NullOr(Schema.String),
  answeredAt: Schema.NullOr(Schema.Finite),
  createdAt: Schema.Finite,
});

export const HelpFileOutcome = Schema.TaggedUnion({
  Filed: { report: StoredHelpReport },
  LimitReached: { limit: Schema.Literals(["per-attendee", "total"]) },
});

export const HelpLookup = Schema.TaggedUnion({
  Found: { report: StoredHelpReport },
  Missing: {},
});

export const HelpListQuery = Schema.Struct({
  cursor: Schema.NullOr(Schema.String),
  limit: Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 })),
  tests: Schema.Literals(["exclude", "include", "only"]),
  unansweredOnly: Schema.Boolean,
});

export const HelpPage = Schema.Struct({
  cursor: Schema.NullOr(Schema.String),
  reports: Schema.Array(StoredHelpReport),
});

export interface HelpDeskLimits {
  readonly perAttendeePerDay: number;
  readonly retentionMillis: number;
  readonly total: number;
}

export const productionHelpLimits: HelpDeskLimits = {
  perAttendeePerDay: HELP_REPORTS_PER_ATTENDEE_PER_DAY,
  retentionMillis: HELP_RETENTION_MILLIS,
  total: HELP_REPORTS_TOTAL,
};
