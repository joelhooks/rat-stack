import { describe, expect, it } from "@effect/vitest";
import {
  Cause,
  ConfigProvider,
  Effect,
  Exit,
  Layer,
  Option,
  Redacted,
  Schema,
} from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as SecureRandom from "effect/crypto/SecureRandom";

import {
  HelpUnavailable,
  NotAnAttendee,
  ReportNotFound,
  Unauthorized,
} from "../src/tokenmaxx-help-contracts.js";
import { emailHashOf } from "../src/tokenmaxx-help-handlers.js";
import {
  HelpCaller,
  SetupHelpAccess,
  SetupHelpGuide,
  answerSetupProblem,
  listSetupProblems,
  readSetupHelpSettings,
  reportSetupProblem,
  setupHelpStatus,
  setupProblemStatus,
} from "../src/tokenmaxx-help.js";
import { memoryHelpDesk } from "./fixtures/help-desk-memory.js";
import { noise, plantedSecret, windowsOf } from "./fixtures/help-secrets.js";

const code = "synthetic-workshop-code";

const operatorToken = "synthetic-operator-token";

const localPart = Arbitrary.schema(
  Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9]{0,11}$/u))
);

const roster = Arbitrary.array(localPart, { maxLength: 6, minLength: 1 }).pipe(
  Arbitrary.map((names) =>
    [...new Set(names)].map((name) => `${name}@example.test`)
  )
);

const failureOf = <A, E>(exit: Exit.Exit<A, E>) =>
  Exit.isFailure(exit)
    ? Option.getOrUndefined(Cause.findErrorOption(exit.cause))
    : undefined;

const rosterIndex = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 }))
);

const hashesOf = (emails: readonly string[]) =>
  Effect.forEach((email: string) => emailHashOf(email))(emails);

const helpFor = (settings: {
  readonly attendees: Option.Option<readonly string[]>;
  readonly code: Option.Option<string>;
  readonly operatorToken?: Option.Option<string>;
  readonly tests?: readonly string[];
  readonly authorization?: Option.Option<string>;
}) =>
  Effect.gen(function* makeHelp() {
    const desk = yield* memoryHelpDesk;

    const layer = Layer.mergeAll(
      desk.layer,
      SetupHelpAccess.configLayer({
        attendees: settings.attendees,
        code: settings.code.pipe(Option.map((value) => Redacted.make(value))),
        operatorToken: (
          settings.operatorToken ?? Option.some(operatorToken)
        ).pipe(Option.map((value) => Redacted.make(value))),
        tests: settings.tests ?? [],
      }),
      SetupHelpGuide.layer([]),
      SecureRandom.layerWebCrypto,
      Layer.succeed(HelpCaller, {
        authorization: (
          settings.authorization ?? Option.some(`Bearer ${operatorToken}`)
        ).pipe(Option.map((value) => Redacted.make(value))),
      })
    );

    return { layer, stored: desk.stored };
  });

const hexHash = Arbitrary.schema(
  Schema.String.check(Schema.isPattern(/^[0-9a-f]{64}$/u))
);

const malformedList = Arbitrary.schema(
  Schema.Literals([
    "not json",
    "{}",
    "[1]",
    '["abc"]',
    `["${"a".repeat(63)}"]`,
    `["${"g".repeat(64)}"]`,
    `["${"a".repeat(64)}",`,
    `"${"a".repeat(64)}"`,
  ])
);

const HashListSetting = Schema.TaggedUnion({
  Malformed: {},
  Unset: {},
  Valid: {
    count: Schema.Int.check(Schema.isBetween({ maximum: 5, minimum: 0 })),
  },
});

const listSetting = Arbitrary.all({
  hashes: Arbitrary.array(hexHash, { maxLength: 5 }),
  malformed: malformedList,
  setting: Arbitrary.schema(HashListSetting),
});

const envValue = (list: {
  readonly hashes: readonly string[];
  readonly malformed: string;
  readonly setting: typeof HashListSetting.Type;
}) => {
  const hashes = [...new Set(list.hashes)];

  return HashListSetting.match(list.setting, {
    Malformed: () => ({ count: 0, value: list.malformed }),
    Unset: () => ({ count: 0, value: undefined }),
    Valid: ({ count }) => {
      const kept = hashes.slice(0, count);

      return { count: kept.length, value: JSON.stringify(kept) };
    },
  });
};

const definedOnly = (
  settings: Readonly<Record<string, string | undefined>>
): Record<string, string> =>
  Object.fromEntries(
    Object.entries(settings).flatMap(([name, value]) =>
      value === undefined ? [] : [[name, value] as const]
    )
  );

const report = (email: string, attempt = code) => ({
  code: attempt,
  email,
  step: 3,
  symptom: "herdr: command not found",
});

describe("Tokenmaxx setup help", () => {
  it.effect.prop(
    "only a listed email with the shared code files a report, and refusals store nothing",
    {
      casing: Arbitrary.schema(Schema.Boolean),
      codeRight: Arbitrary.schema(Schema.Boolean),
      padding: Arbitrary.schema(Schema.Literals(["", " ", "\n", "\t ", "  "])),
      listed: Arbitrary.schema(Schema.Boolean),
      emails: roster,
      stranger: localPart,
    },
    ({ casing, codeRight, emails, listed, padding, stranger }) =>
      Effect.gen(function* checkSignIn() {
        const [first = "someone@example.test"] = emails;
        const outsider = `${stranger}.outside@example.test`;
        const typed = listed ? first : outsider;
        const email = casing ? `  ${typed.toUpperCase()} ` : typed;

        const help = yield* helpFor({
          attendees: Option.some(yield* hashesOf(emails)),
          code: Option.some(code),
        });

        const outcome = yield* reportSetupProblem
          .handler(
            report(
              email,
              codeRight ? `${padding}${code}${padding}` : `${code}-wrong`
            )
          )
          .pipe(Effect.provide(help.layer), Effect.exit);

        const stored = yield* help.stored;

        if (listed && codeRight) {
          expect(Exit.isSuccess(outcome)).toBe(true);
          expect(stored.map((entry) => entry.emailHash)).toStrictEqual([
            yield* emailHashOf(first),
          ]);
        } else {
          expect(failureOf(outcome)).toBeInstanceOf(NotAnAttendee);
          expect(stored).toStrictEqual([]);
        }
      })
  );

  it.effect.prop(
    "a missing attendee list or workshop code makes help unavailable and stores nothing",
    {
      emails: roster,
      missing: Arbitrary.schema(Schema.Literals(["attendees", "code", "both"])),
    },
    ({ emails, missing }) =>
      Effect.gen(function* checkUnconfigured() {
        const [email = "someone@example.test"] = emails;

        const help = yield* helpFor({
          attendees:
            missing === "code"
              ? Option.some(yield* hashesOf(emails))
              : Option.none(),
          code: missing === "attendees" ? Option.some(code) : Option.none(),
        });

        const outcomes = [
          yield* reportSetupProblem
            .handler(report(email))
            .pipe(Effect.provide(help.layer), Effect.flip),
          yield* setupProblemStatus
            .handler({ code, email, reportId: "any" })
            .pipe(Effect.provide(help.layer), Effect.flip),
        ];

        for (const failure of outcomes) {
          expect(failure).toBeInstanceOf(HelpUnavailable);
          expect(failure).toMatchObject({ reason: "not-configured" });
        }

        expect(yield* help.stored).toStrictEqual([]);
      })
  );

  it.effect.prop(
    "the help status counts exactly the decoded hash lists, and a set but malformed attendee list leaves help unconfigured",
    {
      attendees: listSetting,
      codeSet: Arbitrary.schema(Schema.Boolean),
      tests: listSetting,
    },
    ({ attendees, codeSet, tests }) =>
      Effect.gen(function* checkHelpStatus() {
        const attendeeEnv = envValue(attendees);
        const testEnv = envValue(tests);

        const malformedAttendees = HashListSetting.guards.Malformed(
          attendees.setting
        );

        const environment = definedOnly({
          TOKENMAXX_ATTENDEE_HASHES: attendeeEnv.value,
          TOKENMAXX_HELP_OPERATOR_TOKEN: operatorToken,
          TOKENMAXX_TEST_HASHES: testEnv.value,
          TOKENMAXX_WORKSHOP_CODE: codeSet ? code : undefined,
        });

        const settings = yield* readSetupHelpSettings.pipe(
          Effect.provide(
            ConfigProvider.layer(ConfigProvider.fromUnknown(environment))
          )
        );

        const status = yield* setupHelpStatus.handler({}).pipe(
          Effect.provide(
            Layer.merge(
              SetupHelpAccess.configLayer(settings),
              Layer.succeed(HelpCaller, {
                authorization: Option.some(
                  Redacted.make(`Bearer ${operatorToken}`)
                ),
              })
            )
          )
        );

        const testCount = malformedAttendees ? 0 : testEnv.count;

        expect(status).toStrictEqual({
          attendeeCount: attendeeEnv.count,
          codeSet,
          configured:
            codeSet &&
            !malformedAttendees &&
            (HashListSetting.guards.Valid(attendees.setting) || testCount > 0),
          operatorSet: true,
          testCount,
        });

        if (malformedAttendees) {
          const help = yield* helpFor({
            attendees: settings.attendees,
            code: settings.code.pipe(
              Option.map((value) => Redacted.value(value))
            ),
            tests: settings.tests,
          });

          const refused = yield* reportSetupProblem
            .handler(report("sam@example.test"))
            .pipe(Effect.provide(help.layer), Effect.flip);

          expect(refused).toBeInstanceOf(HelpUnavailable);
          expect(refused).toMatchObject({ reason: "not-configured" });
        }
      })
  );

  it.effect.prop(
    "secrets in a report never reach the desk or come back in the reply",
    {
      errorSecret: plantedSecret,
      osSecret: plantedSecret,
      prefix: noise,
      symptomSecret: plantedSecret,
    },
    ({ errorSecret, osSecret, prefix, symptomSecret }) =>
      Effect.gen(function* checkNeverStored() {
        const email = "sam@example.test";

        const help = yield* helpFor({
          attendees: Option.some([yield* emailHashOf(email)]),
          code: Option.some(code),
        });

        const filed = yield* reportSetupProblem
          .handler({
            code,
            email,
            errorText: `${prefix}${errorSecret.text}`,
            os: osSecret.text,
            step: 2,
            symptom: `stuck ${symptomSecret.text}`,
          })
          .pipe(Effect.provide(help.layer));

        const written = JSON.stringify({ filed, stored: yield* help.stored });

        expect(filed.redacted).toBe(true);

        for (const planted of [errorSecret, osSecret, symptomSecret]) {
          for (const piece of windowsOf(planted.secret, 10)) {
            expect(written, planted.kind).not.toContain(piece);
          }
        }

        expect(written).not.toContain(email);
      })
  );

  it.effect.prop(
    "an attendee reads only reports filed under their own email",
    { emails: roster, reader: rosterIndex, writer: rosterIndex },
    ({ emails, reader, writer }) =>
      Effect.gen(function* checkIsolation() {
        const author = emails[writer % emails.length] ?? "a@example.test";
        const asker = emails[reader % emails.length] ?? "a@example.test";

        const help = yield* helpFor({
          attendees: Option.some(yield* hashesOf(emails)),
          code: Option.some(code),
        });

        const { reportId } = yield* reportSetupProblem
          .handler(report(author))
          .pipe(Effect.provide(help.layer));

        const read = yield* setupProblemStatus
          .handler({ code, email: asker, reportId })
          .pipe(Effect.provide(help.layer), Effect.exit);

        if (author === asker) {
          expect(Exit.isSuccess(read) ? read.value : undefined).toMatchObject({
            reportId,
            state: "open",
          });
        } else {
          expect(failureOf(read)).toBeInstanceOf(ReportNotFound);
        }
      })
  );

  it.effect.prop(
    "operator calls need exactly the configured bearer token, and an unset token refuses everyone",
    {
      configured: Arbitrary.schema(Schema.Boolean),
      header: Arbitrary.schema(
        Schema.Literals([
          "missing",
          "exact",
          "wrong",
          "bare",
          "lowercase",
          "padded",
        ])
      ),
    },
    ({ configured, header }) =>
      Effect.gen(function* checkOperatorGate() {
        const headers = {
          bare: Option.some(operatorToken),
          exact: Option.some(`Bearer ${operatorToken}`),
          lowercase: Option.some(`bearer ${operatorToken}`),
          missing: Option.none(),
          padded: Option.some(`Bearer ${operatorToken} `),
          wrong: Option.some(`Bearer ${operatorToken}x`),
        } as const;

        const help = yield* helpFor({
          attendees: Option.some([]),
          authorization: headers[header],
          code: Option.some(code),
          operatorToken: configured
            ? Option.some(operatorToken)
            : Option.none(),
        });

        const listed = yield* listSetupProblems
          .handler({})
          .pipe(Effect.provide(help.layer), Effect.exit);

        const answered = yield* answerSetupProblem
          .handler({ answer: "Try this.", reportId: "missing" })
          .pipe(Effect.provide(help.layer), Effect.exit);

        if (configured && header === "exact") {
          expect(Exit.isSuccess(listed)).toBe(true);
          expect(failureOf(answered)).toBeInstanceOf(ReportNotFound);
        } else {
          expect(failureOf(listed)).toBeInstanceOf(Unauthorized);
          expect(failureOf(answered)).toBeInstanceOf(Unauthorized);
        }
      })
  );

  it.effect.prop(
    "test identities file like attendees, are flagged, and stay out of the default operator list",
    { emails: roster, tester: localPart },
    ({ emails, tester }) =>
      Effect.gen(function* checkTestIdentities() {
        const testEmail = `${tester}.test-run@example.test`;
        const testHash = yield* emailHashOf(testEmail);
        const [attendee = "a@example.test"] = emails;

        const help = yield* helpFor({
          attendees: Option.some(yield* hashesOf(emails)),
          code: Option.some(code),
          tests: [testHash],
        });

        const real = yield* reportSetupProblem
          .handler(report(attendee))
          .pipe(Effect.provide(help.layer));

        const probe = yield* reportSetupProblem
          .handler(report(testEmail))
          .pipe(Effect.provide(help.layer));

        const listing = (tests?: "exclude" | "include" | "only") =>
          listSetupProblems.handler(tests === undefined ? {} : { tests }).pipe(
            Effect.provide(help.layer),
            Effect.map((page) =>
              page.reports.map((entry) => [entry.reportId, entry.test])
            )
          );

        expect(yield* listing()).toStrictEqual([[real.reportId, false]]);
        expect(yield* listing("only")).toStrictEqual([[probe.reportId, true]]);
        expect(yield* listing("include")).toStrictEqual([
          [probe.reportId, true],
          [real.reportId, false],
        ]);
      })
  );
});
