import { defineContract } from "@rat-stack/capability/contract";
import { Schema } from "effect";

import { AssetReadError } from "./asset-read-error.js";
import { HelpLimitReached } from "./tokenmaxx-help-limit-reached.js";
import { NotAnAttendee } from "./tokenmaxx-help-not-an-attendee.js";
import { ReportNotFound } from "./tokenmaxx-help-report-not-found.js";
import { Unauthorized } from "./tokenmaxx-help-unauthorized.js";
import { HelpUnavailable } from "./tokenmaxx-help-unavailable.js";

export { NotAnAttendee } from "./tokenmaxx-help-not-an-attendee.js";

export { HelpUnavailable } from "./tokenmaxx-help-unavailable.js";

export { ReportNotFound } from "./tokenmaxx-help-report-not-found.js";

export { Unauthorized } from "./tokenmaxx-help-unauthorized.js";

export { HelpLimitReached } from "./tokenmaxx-help-limit-reached.js";

const encoder = new TextEncoder();

const atMostBytes = (bytes: number) =>
  Schema.makeFilter(
    (text: string) =>
      encoder.encode(text).length <= bytes || `Keep this under ${bytes} bytes.`
  );

export const SetupStep = Schema.Int.check(
  Schema.isBetween({ maximum: 7, minimum: 1 })
);

export const GuideEntry = Schema.Struct({
  fix: Schema.String,
  steps: Schema.Array(SetupStep),
  symptom: Schema.String,
  tested: Schema.Boolean,
});

const Email = Schema.String.check(Schema.isBetweenLength(3, 320));

const WorkshopCode = Schema.String.check(Schema.isBetweenLength(1, 200));

const ReportId = Schema.String.check(Schema.isBetweenLength(1, 64));

const Utc = Schema.String;

export const SetupProblemFiled = Schema.Struct({
  guidance: Schema.Array(GuideEntry),
  next: Schema.String,
  redacted: Schema.Boolean,
  reportId: Schema.String,
});

export const SetupProblemState = Schema.Struct({
  answer: Schema.NullOr(Schema.String),
  answeredAt: Schema.NullOr(Utc),
  createdAt: Utc,
  reportId: Schema.String,
  state: Schema.Literals(["open", "answered"]),
  step: SetupStep,
});

export const SetupProblemReport = Schema.Struct({
  ...SetupProblemState.fields,
  emailHash: Schema.String,
  errorText: Schema.NullOr(Schema.String),
  matched: Schema.Int,
  os: Schema.NullOr(Schema.String),
  redacted: Schema.Boolean,
  symptom: Schema.String,
  test: Schema.Boolean,
});

export const SetupProblemPage = Schema.Struct({
  cursor: Schema.NullOr(Schema.String),
  reports: Schema.Array(SetupProblemReport),
});

const attendee = {
  code: WorkshopCode.annotate({
    description: "The workshop code on your workshop calendar event.",
  }),
  email: Email.annotate({
    description: "The email address the workshop invite went to.",
  }),
};

export const reportSetupProblemContract = defineContract("reportSetupProblem", {
  description:
    "Tell the Tokenmaxx workshop desk where setup is stuck. Returns known fixes for that step and a reportId; a person reads every report. Returned fixes are keyword matches; compare each symptom with the error before acting.",
  failure: Schema.Union([
    NotAnAttendee,
    HelpUnavailable,
    HelpLimitReached,
    AssetReadError,
  ]),
  input: Schema.Struct({
    ...attendee,
    errorText: Schema.optionalKey(
      Schema.String.check(atMostBytes(4096)).annotate({
        description:
          "The exact error output, at most 4 KB. Secrets are removed before anything is stored.",
      })
    ),
    os: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(100))),
    step: SetupStep.annotate({
      description:
        "The setup step that is stuck: 1 Node, pnpm, git and Pi; 2 the workshop tools; 3 Herdr; 4 a model for Pi; 5 the check; 6 your own repo; 7 report.",
    }),
    symptom: Schema.String.check(Schema.isBetweenLength(1, 500)).annotate({
      description: "One or two sentences on what went wrong.",
    }),
  }),
  output: SetupProblemFiled,
});

export const setupProblemStatusContract = defineContract("setupProblemStatus", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Read whether the workshop desk has answered a setup report you filed.",
  failure: Schema.Union([NotAnAttendee, HelpUnavailable, ReportNotFound]),
  input: Schema.Struct({ ...attendee, reportId: ReportId }),
  output: SetupProblemState,
});

export const listSetupProblemsContract = defineContract("listSetupProblems", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Operator only: list setup reports, newest first. Test reports are left out unless asked for.",
  failure: Schema.Union([Unauthorized, HelpUnavailable]),
  input: Schema.Struct({
    cursor: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(200))),
    limit: Schema.optionalKey(
      Schema.Int.check(Schema.isBetween({ maximum: 100, minimum: 1 }))
    ),
    tests: Schema.optionalKey(Schema.Literals(["exclude", "include", "only"])),
    unansweredOnly: Schema.optionalKey(Schema.Boolean),
  }),
  output: SetupProblemPage,
});

export const SetupHelpStatus = Schema.Struct({
  attendeeCount: Schema.Int,
  codeSet: Schema.Boolean,
  configured: Schema.Boolean,
  operatorSet: Schema.Boolean,
  testCount: Schema.Int,
});

export const setupHelpStatusContract = defineContract("setupHelpStatus", {
  annotations: { idempotent: true, readOnly: true },
  description:
    "Operator only: report whether attendee sign-in is configured and how many attendee and test hashes the Worker holds. Returns counts only, never hashes or values.",
  failure: Unauthorized,
  input: Schema.Struct({}),
  output: SetupHelpStatus,
});

export const answerSetupProblemContract = defineContract("answerSetupProblem", {
  annotations: { idempotent: true },
  description: "Operator only: answer a setup report.",
  failure: Schema.Union([Unauthorized, HelpUnavailable, ReportNotFound]),
  input: Schema.Struct({
    answer: Schema.String.check(Schema.isBetweenLength(1, 4000)),
    reportId: ReportId,
  }),
  output: SetupProblemReport,
});
