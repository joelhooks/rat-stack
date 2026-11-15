import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Test from "@alchemy.run/test/Vitest";
import { expect } from "@effect/vitest";
import {
  HelpFileOutcome,
  HelpLookup,
  HelpPage,
} from "@rat-stack/core/tokenmaxx-help-store";
import type {
  HelpListQuery,
  NewHelpReport,
} from "@rat-stack/core/tokenmaxx-help-store";
import { ConfigProvider, Effect, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import * as SecureRandom from "effect/crypto/SecureRandom";
import { HttpClient, HttpClientRequest } from "effect/http";

import { eventually, localServices } from "./fixtures/flag-ledger-client.js";
import {
  DeskCommand,
  DeskRequest,
  fixtureLimits,
} from "./fixtures/help-desk-protocol.js";
import HelpDeskWorker from "./fixtures/help-desk-worker.js";
import { durableObjectRow } from "./fixtures/local-storage.js";
import { deployScratch } from "./fixtures/scratch-deploy.js";

const { test } = Test.make({
  dev: true,
  providers: Cloudflare.providers(),
  sidecar: false,
  stage: `help_desk_runtime_${process.pid}`,
});

const encodeRequest = Schema.encodeEffect(Schema.fromJsonString(DeskRequest));

const deskClient = (
  url: string,
  desk: "expiring" | "limited",
  instance: string
) => {
  const send =
    <S extends Schema.Decoder<unknown>>(schema: S) =>
    (command: (typeof DeskRequest.Type)["command"]) =>
      encodeRequest({ command, desk, instance }).pipe(
        Effect.map((body) =>
          HttpClientRequest.post(url).pipe(
            HttpClientRequest.bodyText(body, "application/json")
          )
        ),
        Effect.flatMap(HttpClient.execute),
        Effect.flatMap((response) => response.text),
        Effect.flatMap(
          Schema.decodeUnknownEffect(Schema.fromJsonString(schema))
        ),
        Effect.orDie
      );

  return {
    answer: (reportId: string, answer: string) =>
      send(HelpLookup)(DeskCommand.cases.Answer.make({ answer, reportId })),
    file: (report: typeof NewHelpReport.Type) =>
      send(HelpFileOutcome)(DeskCommand.cases.File.make({ report })),
    find: (reportId: string) =>
      send(HelpLookup)(DeskCommand.cases.Find.make({ reportId })),
    list: (query: typeof HelpListQuery.Type) =>
      send(HelpPage)(DeskCommand.cases.List.make({ query })),
  };
};

type DeskClient = ReturnType<typeof deskClient>;

const deploy = (stack: Test.ScratchStack) =>
  Effect.gen(function* deployHelpDesk() {
    const worker = yield* deployScratch(stack, HelpDeskWorker);

    return yield* Effect.fromNullishOr(worker.url);
  }).pipe(Effect.orDie);

const freshInstance = SecureRandom.SecureRandom.use((random) =>
  random.uuidV4()
);

const hashOf = (attendee: number) => String(attendee).repeat(64);

const newReport = (
  run: string,
  index: number,
  attendee: number,
  step: number,
  isTest: boolean
): typeof NewHelpReport.Type => ({
  emailHash: hashOf(attendee),
  errorText: index % 2 === 0 ? null : `error ${String(index)}`,
  matched: index % 3,
  os: null,
  redacted: index % 2 === 0,
  reportId: `${run}-${String(index).padStart(4, "0")}`,
  step,
  symptom: `symptom ${String(index)}`,
  test: isTest,
});

const Step = Schema.TaggedUnion({
  Answer: {
    target: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 })),
  },
  File: {
    attendee: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 0 })),
    step: Schema.Int.check(Schema.isBetween({ maximum: 7, minimum: 1 })),
    test: Schema.Boolean,
  },
  Find: {
    target: Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 })),
  },
  List: {
    limit: Schema.Int.check(Schema.isBetween({ maximum: 3, minimum: 1 })),
    tests: Schema.Literals(["exclude", "include", "only"]),
    unansweredOnly: Schema.Boolean,
  },
});

const stepKinds = [
  ...Array.from({ length: 6 }, () => Step.cases.File),
  Step.cases.Answer,
  Step.cases.Find,
  Step.cases.List,
  Step.cases.List,
];

const foundReport = (lookup: typeof HelpLookup.Type) =>
  HelpLookup.guards.Found(lookup) ? lookup.report : undefined;

const filedReport = (outcome: typeof HelpFileOutcome.Type) =>
  HelpFileOutcome.guards.Filed(outcome) ? outcome.report : undefined;

const weightedStep = Arbitrary.flatMap(
  Arbitrary.schema(
    Schema.Int.check(Schema.isBetween({ maximum: 9, minimum: 0 }))
  ),
  (roll) => Arbitrary.schema(stepKinds[roll] ?? Step.cases.List)
);

interface Modelled {
  readonly attempts: number;
  readonly reports: readonly {
    readonly answer: string | null;
    readonly report: typeof NewHelpReport.Type;
  }[];
}

const pagesOf = (
  client: DeskClient,
  query: Omit<typeof HelpListQuery.Type, "cursor">,
  bound: number
) => {
  const next = (
    cursor: string | null,
    seen: readonly (typeof HelpPage.Type)[]
  ): Effect.Effect<
    readonly (typeof HelpPage.Type)[],
    never,
    HttpClient.HttpClient
  > =>
    seen.length > bound
      ? Effect.die(`More than ${String(bound)} pages`)
      : client
          .list({ ...query, cursor })
          .pipe(
            Effect.flatMap((page) =>
              page.cursor === null
                ? Effect.succeed([...seen, page])
                : next(page.cursor, [...seen, page])
            )
          );

  return next(null, []);
};

const apply =
  (client: DeskClient, run: string) =>
  (model: Modelled, step: typeof Step.Type) =>
    Step.match(step, {
      Answer: ({ target }) =>
        Effect.gen(function* answerStep() {
          const known = model.reports[target];

          const reportId =
            known?.report.reportId ?? `missing-${String(target)}`;

          const answer = `answer ${String(model.attempts)}`;
          const outcome = yield* client.answer(reportId, answer);

          if (known === undefined) {
            expect(HelpLookup.guards.Missing(outcome)).toBe(true);

            return { ...model, attempts: model.attempts + 1 };
          }

          expect(foundReport(outcome)).toMatchObject({
            ...known.report,
            answer,
          });

          return {
            attempts: model.attempts + 1,
            reports: model.reports.with(target, { ...known, answer }),
          };
        }),
      File: ({ attendee, step: setupStep, test: isTest }) =>
        Effect.gen(function* fileStep() {
          const report = newReport(
            run,
            model.attempts,
            attendee,
            setupStep,
            isTest
          );

          const outcome = yield* client.file(report);

          const mine = model.reports.filter(
            (entry) => entry.report.emailHash === report.emailHash
          ).length;

          const next = { ...model, attempts: model.attempts + 1 };

          if (mine >= fixtureLimits.perAttendeePerDay) {
            expect(outcome).toStrictEqual(
              HelpFileOutcome.cases.LimitReached.make({ limit: "per-attendee" })
            );

            return next;
          }

          if (model.reports.length >= fixtureLimits.total) {
            expect(outcome).toStrictEqual(
              HelpFileOutcome.cases.LimitReached.make({ limit: "total" })
            );

            return next;
          }

          expect(filedReport(outcome)).toMatchObject({
            ...report,
            answer: null,
            answeredAt: null,
          });

          return {
            ...next,
            reports: [...model.reports, { answer: null, report }],
          };
        }),
      Find: ({ target }) =>
        Effect.gen(function* findStep() {
          const known = model.reports[target];

          const outcome = yield* client.find(
            known?.report.reportId ?? `missing-${String(target)}`
          );

          if (known === undefined) {
            expect(HelpLookup.guards.Missing(outcome)).toBe(true);
          } else {
            expect(foundReport(outcome)).toMatchObject({
              ...known.report,
              answer: known.answer,
            });
          }

          return model;
        }),
      List: ({ limit, tests, unansweredOnly }) =>
        Effect.gen(function* listStep() {
          const expected = model.reports
            .filter(
              (entry) =>
                (!unansweredOnly || entry.answer === null) &&
                (tests === "include" ||
                  entry.report.test === (tests === "only"))
            )
            .map((entry) => entry.report.reportId)
            .toReversed();

          const bound = Math.floor(expected.length / limit) + 1;

          const pages = yield* pagesOf(
            client,
            { limit, tests, unansweredOnly },
            bound
          );

          expect(pages.every((page) => page.reports.length <= limit)).toBe(
            true
          );
          expect(
            pages.flatMap((page) =>
              page.reports.map((report) => report.reportId)
            )
          ).toStrictEqual(expected);

          return model;
        }),
    });

const syntheticHash = (digit: string) => digit.repeat(64);

test.provider(
  "a Worker that reads the help settings during Init receives every configured help secret at runtime",
  (stack) =>
    Effect.gen(function* checkHelpSecretsBound() {
      const url = yield* deployScratch(
        stack,
        HelpDeskWorker.pipe(
          Effect.provide(
            ConfigProvider.layer(
              ConfigProvider.fromUnknown({
                TOKENMAXX_ATTENDEE_HASHES: JSON.stringify([
                  syntheticHash("a"),
                  syntheticHash("b"),
                ]),
                TOKENMAXX_HELP_OPERATOR_TOKEN: "synthetic-operator-token",
                TOKENMAXX_TEST_HASHES: JSON.stringify([syntheticHash("c")]),
                TOKENMAXX_WORKSHOP_CODE: "synthetic-code",
              })
            )
          )
        )
      ).pipe(Effect.flatMap((worker) => Effect.fromNullishOr(worker.url)));

      const seen = yield* HttpClient.get(new URL("/access", url)).pipe(
        Effect.flatMap((response) => response.json)
      );

      expect(seen).toStrictEqual({
        attendees: 2,
        code: true,
        operator: true,
        tests: 1,
      });
    }).pipe(Effect.provide(localServices), Effect.orDie)
);

test.provider(
  "the help desk follows an independent model of filing, answering, limits and newest-first pages",
  (stack) =>
    Effect.gen(function* checkHelpDeskModel() {
      const url = yield* deploy(stack);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.array(weightedStep, { maxLength: 20 }),
        (steps) =>
          Effect.gen(function* runHistory() {
            const run = yield* freshInstance;
            const client = deskClient(url, "limited", run);

            yield* Effect.reduce(
              steps,
              () => ({ attempts: 0, reports: [] }),
              apply(client, run)
            );

            return true;
          }),
        { maxShrinks: 20, runs: 20 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

const listEverything = [1, 2, 3].flatMap((limit) =>
  (["exclude", "include", "only"] as const).flatMap((tests) =>
    [true, false].map((unansweredOnly) =>
      Step.cases.List.make({ limit, tests, unansweredOnly })
    )
  )
);

const replay = (url: string, steps: readonly (typeof Step.Type)[]) =>
  Effect.gen(function* replayHistory() {
    const run = yield* freshInstance;
    const client = deskClient(url, "limited", run);

    return yield* Effect.reduce(
      steps,
      (): Modelled => ({ attempts: 0, reports: [] }),
      apply(client, run)
    );
  });

test.provider(
  "every page and filter returns each matching report exactly once, newest first, and the caps refuse the rest",
  (stack) =>
    Effect.gen(function* checkPagesAndCaps() {
      const url = yield* deploy(stack);

      const full = yield* replay(url, [
        ...[0, 0, 0, 0, 1, 2, 3, 1].map((attendee) =>
          Step.cases.File.make({ attendee, step: 2, test: attendee === 3 })
        ),
        ...listEverything,
      ]);

      expect(full.reports.length).toBe(fixtureLimits.total);

      const result = yield* Arbitrary.checkEffect(
        Arbitrary.all({
          answered: Arbitrary.array(Arbitrary.schema(Step.cases.Answer), {
            maxLength: 4,
          }),
          files: Arbitrary.array(Arbitrary.schema(Step.cases.File), {
            maxLength: 9,
          }),
        }),
        ({ answered, files }) =>
          replay(url, [...files, ...answered, ...listEverything]).pipe(
            Effect.as(true)
          ),
        { maxShrinks: 10, runs: 10 }
      );

      expect(Arbitrary.formatCheckFailure(result)).toBeUndefined();
    }).pipe(Effect.provide(localServices)),
  { timeout: 300_000 }
);

test.provider(
  "the alarm deletes each report from storage once its retention ends, and re-arms for the next one",
  (stack) =>
    Effect.gen(function* checkExpiryAlarm() {
      const url = yield* deploy(stack);
      const run = yield* freshInstance;
      const client = deskClient(url, "expiring", run);
      const first = newReport(run, 1, 1, 3, false);
      const second = newReport(run, 2, 2, 4, false);

      expect(filedReport(yield* client.file(first))).toBeDefined();

      const firstRow = yield* durableObjectRow(
        "ExpiringHelpDesk",
        "help_reports",
        first.reportId
      );

      expect(yield* firstRow.rows).toBe(1);
      expect(yield* firstRow.alarmPending).toBe(true);

      yield* Effect.sleep("1500 millis");

      expect(filedReport(yield* client.file(second))).toBeDefined();

      const secondRow = yield* durableObjectRow(
        "ExpiringHelpDesk",
        "help_reports",
        second.reportId
      );

      yield* eventually(
        Effect.all([firstRow.rows, secondRow.rows, secondRow.alarmPending]),
        ([firstLeft, secondLeft, pending]) =>
          firstLeft === 0 && secondLeft === 1 && pending
      );

      expect(
        HelpLookup.guards.Missing(yield* client.find(first.reportId))
      ).toBe(true);
      expect(foundReport(yield* client.find(second.reportId))).toBeDefined();

      yield* eventually(
        Effect.all([secondRow.rows, secondRow.alarmPending]),
        ([secondLeft, pending]) => secondLeft === 0 && !pending
      );
    }).pipe(Effect.scoped, Effect.provide(localServices)),
  { timeout: 120_000 }
);
