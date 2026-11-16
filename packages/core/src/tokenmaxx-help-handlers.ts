import { DateTime, Effect, Option, Redacted } from "effect";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { Hex } from "effect/encoding";

import { SetupHelpAccess, signInReady } from "./tokenmaxx-help-access.js";
import { HelpCaller } from "./tokenmaxx-help-caller.js";
import {
  HelpLimitReached,
  HelpUnavailable,
  NotAnAttendee,
  ReportNotFound,
  Unauthorized,
} from "./tokenmaxx-help-contracts.js";
import type {
  SetupProblemReport,
  SetupProblemState,
  answerSetupProblemContract,
  listSetupProblemsContract,
  reportSetupProblemContract,
  setupHelpStatusContract,
  setupProblemStatusContract,
} from "./tokenmaxx-help-contracts.js";
import { SetupHelpDesk } from "./tokenmaxx-help-desk.js";
import { SetupHelpGuide } from "./tokenmaxx-help-guide-source.js";
import { guidanceFor } from "./tokenmaxx-help-guide.js";
import { scrubSecrets } from "./tokenmaxx-help-scrub.js";
import { HelpFileOutcome, HelpLookup } from "./tokenmaxx-help-store.js";
import type { StoredHelpReport } from "./tokenmaxx-help-store.js";

const encoder = new TextEncoder();

const sha256 = (text: string) =>
  Effect.promise(() =>
    crypto.subtle.digest("SHA-256", encoder.encode(text))
  ).pipe(Effect.map((digest) => new Uint8Array(digest)));

const sameBytes = (left: Uint8Array, right: Uint8Array) => {
  let differences = left.length === right.length ? 0 : 1;

  for (const [index, byte] of left.entries()) {
    differences += byte === right[index] ? 0 : 1;
  }

  return differences === 0;
};

const secretsMatch = (given: string, expected: string) =>
  Effect.all([sha256(given), sha256(expected)]).pipe(
    Effect.map(([left, right]) => sameBytes(left, right))
  );

export const emailHashOf = (email: string) =>
  sha256(email.trim().toLowerCase()).pipe(Effect.map(Hex.encode));

const notConfigured = new HelpUnavailable({
  message:
    "The workshop help desk isn't open yet. Reply to the workshop email for help instead.",
  reason: "not-configured",
});

const notAnAttendee = new NotAnAttendee({
  message:
    "This email and workshop code don't match the attendee list. Use the email the workshop invite went to and the workshop code on your workshop calendar event.",
});

const signIn = Effect.fn("tokenmaxxHelp.signIn")(function* signIn(input: {
  readonly code: string;
  readonly email: string;
}) {
  const access = yield* SetupHelpAccess;

  if (!signInReady(access) || Option.isNone(access.code)) {
    return yield* notConfigured;
  }

  const emailHash = yield* emailHashOf(input.email);
  const hashBytes = encoder.encode(emailHash);

  const listed = [
    ...Option.getOrElse(access.attendees, () => []),
    ...access.tests,
  ]
    .map((candidate) => sameBytes(encoder.encode(candidate), hashBytes))
    .includes(true);

  const codeMatches = yield* secretsMatch(
    input.code.trim(),
    Redacted.value(access.code.value).trim()
  );

  if (!listed || !codeMatches) {
    return yield* notAnAttendee;
  }

  return { emailHash, test: access.tests.includes(emailHash) };
});

const unauthorized = new Unauthorized({
  message:
    "Operator calls need the header `Authorization: Bearer <token>` with the help desk operator token.",
});

const asOperator = Effect.fn("tokenmaxxHelp.asOperator")(
  function* asOperator() {
    const access = yield* SetupHelpAccess;
    const caller = yield* HelpCaller;

    if (
      Option.isNone(access.operatorToken) ||
      Option.isNone(caller.authorization)
    ) {
      return yield* unauthorized;
    }

    const allowed = yield* secretsMatch(
      Redacted.value(caller.authorization.value),
      `Bearer ${Redacted.value(access.operatorToken.value)}`
    );

    if (!allowed) {
      return yield* unauthorized;
    }

    return "operator" as const;
  }
);

const utc = (millis: number) => DateTime.formatIso(DateTime.makeUnsafe(millis));

const stateOf = (
  report: typeof StoredHelpReport.Type
): typeof SetupProblemState.Type => ({
  answer: report.answer,
  answeredAt: report.answeredAt === null ? null : utc(report.answeredAt),
  createdAt: utc(report.createdAt),
  reportId: report.reportId,
  state: report.answer === null ? "open" : "answered",
  step: report.step,
});

const reportOf = (
  report: typeof StoredHelpReport.Type
): typeof SetupProblemReport.Type => ({
  ...stateOf(report),
  emailHash: report.emailHash,
  errorText: report.errorText,
  matched: report.matched,
  os: report.os,
  redacted: report.redacted,
  symptom: report.symptom,
  test: report.test,
});

const scrubOptional = (text: string | undefined) =>
  text === undefined ? null : scrubSecrets(text);

const nextStep = (matched: number) =>
  `${matched === 0 ? "No known fix matches this yet." : "These known fixes matched words in your report. Check each fix's symptom against your error before trying it; some may not apply."} A person at the workshop desk reads every report. Call setupProblemStatus with this reportId to see their answer, or reply to the workshop email.`;

const limitMessages = {
  "per-attendee":
    "This email has filed the most reports allowed in one day. Reply to the workshop email instead; a person reads it.",
  total:
    "The help desk can't take more reports right now. Reply to the workshop email instead; a person reads it.",
} as const;

export const reportSetupProblem = Effect.fn("tokenmaxxHelp.report")(
  function* reportSetupProblem(
    input: typeof reportSetupProblemContract.input.Type
  ) {
    const caller = yield* signIn(input);
    const symptom = scrubSecrets(input.symptom);
    const errorText = scrubOptional(input.errorText);
    const os = scrubOptional(input.os);
    const rows = yield* (yield* SetupHelpGuide).rows;

    const guidance = guidanceFor(
      rows,
      input.step,
      `${symptom.text}\n${errorText?.text ?? ""}`
    );

    const redacted =
      symptom.redacted || errorText?.redacted === true || os?.redacted === true;

    const random = yield* SecureRandom.SecureRandom;
    const reportId = yield* random.uuidV4();

    const outcome = yield* (yield* SetupHelpDesk).file({
      emailHash: caller.emailHash,
      errorText: errorText?.text ?? null,
      matched: guidance.length,
      os: os?.text ?? null,
      redacted,
      reportId,
      step: input.step,
      symptom: symptom.text,
      test: caller.test,
    });

    return yield* HelpFileOutcome.match(outcome, {
      Filed: ({ report }) =>
        Effect.succeed({
          guidance,
          next: nextStep(guidance.length),
          redacted,
          reportId: report.reportId,
        }),
      LimitReached: ({ limit }) =>
        Effect.fail(
          new HelpLimitReached({ limit, message: limitMessages[limit] })
        ),
    });
  }
);

const notFound = (reportId: string) =>
  new ReportNotFound({
    message:
      "No report with this id was filed under this email. Reports are deleted 14 days after they are filed.",
    reportId,
  });

export const setupProblemStatus = Effect.fn("tokenmaxxHelp.status")(
  function* setupProblemStatus(
    input: typeof setupProblemStatusContract.input.Type
  ) {
    const caller = yield* signIn(input);
    const found = yield* (yield* SetupHelpDesk).find(input.reportId);

    return yield* HelpLookup.match(found, {
      Found: ({ report }) =>
        sameBytes(
          encoder.encode(report.emailHash),
          encoder.encode(caller.emailHash)
        )
          ? Effect.succeed(stateOf(report))
          : Effect.fail(notFound(input.reportId)),
      Missing: () => Effect.fail(notFound(input.reportId)),
    });
  }
);

export const listSetupProblems = Effect.fn("tokenmaxxHelp.list")(
  function* listSetupProblems(
    input: typeof listSetupProblemsContract.input.Type
  ) {
    yield* asOperator();

    const page = yield* (yield* SetupHelpDesk).list({
      cursor: input.cursor ?? null,
      limit: input.limit ?? 50,
      tests: input.tests ?? "exclude",
      unansweredOnly: input.unansweredOnly ?? false,
    });

    return { cursor: page.cursor, reports: page.reports.map(reportOf) };
  }
);

export const setupHelpStatus = Effect.fn("tokenmaxxHelp.helpStatus")(
  function* setupHelpStatus(_input: typeof setupHelpStatusContract.input.Type) {
    yield* asOperator();
    const access = yield* SetupHelpAccess;

    return {
      attendeeCount: new Set(Option.getOrElse(access.attendees, () => [])).size,
      codeSet: Option.isSome(access.code),
      configured: signInReady(access),
      operatorSet: Option.isSome(access.operatorToken),
      testCount: new Set(access.tests).size,
    };
  }
);

export const answerSetupProblem = Effect.fn("tokenmaxxHelp.answer")(
  function* answerSetupProblem(
    input: typeof answerSetupProblemContract.input.Type
  ) {
    yield* asOperator();

    const answered = yield* (yield* SetupHelpDesk).answer(
      input.reportId,
      input.answer
    );

    return yield* HelpLookup.match(answered, {
      Found: ({ report }) => Effect.succeed(reportOf(report)),
      Missing: () =>
        Effect.fail(
          new ReportNotFound({
            message:
              "No report has this id. It may be older than 14 days; list reports again with `pnpm --filter @rat-stack/site help:reports <origin>`.",
            reportId: input.reportId,
          })
        ),
    });
  }
);
