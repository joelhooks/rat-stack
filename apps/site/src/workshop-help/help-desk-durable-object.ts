import * as Cloudflare from "@alchemy.run/cloudflare";
import {
  HELP_DAY_MILLIS,
  HelpFileOutcome,
  HelpLookup,
  StoredHelpReport,
  productionHelpLimits,
} from "@rat-stack/core/tokenmaxx-help-store";
import type {
  HelpDeskLimits,
  HelpListQuery,
  HelpPage,
  NewHelpReport,
} from "@rat-stack/core/tokenmaxx-help-store";
import type { RuntimeContext } from "alchemy/RuntimeContext";
import type { SqlStorageValue } from "alchemy/Workers/Workerd/DurableObjectStorage";
import { Clock, Effect, Option, Schema } from "effect";

export interface HelpDeskOperations {
  readonly alarm: () => Effect.Effect<void, never, RuntimeContext>;
  readonly answer: (
    reportId: string,
    answer: string
  ) => Effect.Effect<typeof HelpLookup.Type>;
  readonly file: (
    report: typeof NewHelpReport.Type
  ) => Effect.Effect<typeof HelpFileOutcome.Type>;
  readonly find: (reportId: string) => Effect.Effect<typeof HelpLookup.Type>;
  readonly list: (
    query: typeof HelpListQuery.Type
  ) => Effect.Effect<typeof HelpPage.Type>;
}

const ReportRow = Schema.Struct({
  answer: Schema.NullOr(Schema.String),
  answered_at: Schema.NullOr(Schema.Finite),
  created_at: Schema.Finite,
  email_hash: Schema.String,
  error_text: Schema.NullOr(Schema.String),
  id: Schema.String,
  matched: Schema.Finite,
  os: Schema.NullOr(Schema.String),
  redacted: Schema.Finite,
  step: Schema.Finite,
  symptom: Schema.String,
  test: Schema.Finite,
});

const decodeRow = Schema.decodeUnknownEffect(ReportRow);

const decodeReport = Schema.decodeUnknownEffect(StoredHelpReport);

const CountRow = Schema.Struct({ total: Schema.Finite });

const OldestRow = Schema.Struct({ oldest: Schema.NullOr(Schema.Finite) });

const Cursor = Schema.Struct({
  createdAt: Schema.Finite,
  id: Schema.String,
});

const encodeCursor = Schema.encodeSync(Schema.fromJsonString(Cursor));

const decodeCursor = Schema.decodeUnknownOption(Schema.fromJsonString(Cursor));

const columns =
  "id, email_hash, test, step, symptom, error_text, os, redacted, matched, created_at, answer, answered_at";

const reportOf = (row: Readonly<Record<string, SqlStorageValue>>) =>
  decodeRow(row).pipe(
    Effect.flatMap((decoded) =>
      decodeReport({
        answer: decoded.answer,
        answeredAt: decoded.answered_at,
        createdAt: decoded.created_at,
        emailHash: decoded.email_hash,
        errorText: decoded.error_text,
        matched: decoded.matched,
        os: decoded.os,
        redacted: decoded.redacted === 1,
        reportId: decoded.id,
        step: decoded.step,
        symptom: decoded.symptom,
        test: decoded.test === 1,
      })
    ),
    Effect.orDie
  );

export type HelpDeskDefinition = Effect.Effect<
  Cloudflare.DurableObject<HelpDeskOperations>,
  never,
  Cloudflare.Worker
> &
  (new (_: never) => HelpDeskOperations);

export const defineHelpDesk = (
  name: string,
  limits: HelpDeskLimits
): HelpDeskDefinition => {
  class HelpDeskDefinition extends Cloudflare.DurableObject<HelpDeskDefinition>()(
    name,
    Effect.gen(function* declareHelpDesk() {
      const state = yield* Cloudflare.DurableObjectState;

      const exec = (query: string, ...bindings: readonly unknown[]) =>
        state.storage.sql.exec(query, ...bindings);

      const write = (query: string, ...bindings: readonly unknown[]) =>
        exec(query, ...bindings).pipe(Effect.asVoid);

      const rows = (query: string, ...bindings: readonly unknown[]) =>
        exec(query, ...bindings).pipe(
          Effect.flatMap((cursor) => cursor.toArray()),
          Effect.flatMap(Effect.forEach(reportOf))
        );

      const count = (query: string, ...bindings: readonly unknown[]) =>
        exec(query, ...bindings).pipe(
          Effect.flatMap((cursor) => cursor.one()),
          Effect.flatMap(Schema.decodeUnknownEffect(CountRow)),
          Effect.map(({ total }) => total),
          Effect.orDie
        );

      // @effect-diagnostics-next-line returnEffectInGen:off -- Alchemy's DurableObject contract returns the per-instance Effect.
      return Effect.gen(function* makeHelpDesk() {
        const runtime = yield* Effect.context<RuntimeContext>();

        const run = <A, E>(effect: Effect.Effect<A, E, RuntimeContext>) =>
          effect.pipe(Effect.provideContext(runtime));

        yield* write(
          "create table if not exists help_reports (id text primary key, email_hash text not null, test integer not null, step integer not null, symptom text not null, error_text text, os text, redacted integer not null, matched integer not null, created_at integer not null, answer text, answered_at integer)"
        );

        yield* write(
          "create index if not exists help_reports_by_attendee on help_reports (email_hash, created_at)"
        );

        yield* write(
          "create index if not exists help_reports_by_age on help_reports (created_at, id)"
        );

        const freshSince = Clock.currentTimeMillis.pipe(
          Effect.map((now) => now - limits.retentionMillis)
        );

        const lookup = (reportId: string) =>
          Effect.gen(function* lookupReport() {
            const since = yield* freshSince;

            const [report] = yield* rows(
              `select ${columns} from help_reports where id = ? and created_at > ?`,
              reportId,
              since
            );

            return report === undefined
              ? HelpLookup.cases.Missing.make({})
              : HelpLookup.cases.Found.make({ report });
          });

        const armExpiry = Effect.gen(function* armExpiry() {
          const { oldest } = yield* exec(
            "select min(created_at) as oldest from help_reports"
          ).pipe(
            Effect.flatMap((cursor) => cursor.one()),
            Effect.flatMap(Schema.decodeUnknownEffect(OldestRow)),
            Effect.orDie
          );

          yield* oldest === null
            ? state.storage.deleteAlarm()
            : state.storage.setAlarm(oldest + limits.retentionMillis);
        });

        const fileReport = (report: typeof NewHelpReport.Type) =>
          Effect.gen(function* fileHelpReport() {
            const existing = yield* lookup(report.reportId);

            if (HelpLookup.guards.Found(existing)) {
              return HelpFileOutcome.cases.Filed.make({
                report: existing.report,
              });
            }

            const now = yield* Clock.currentTimeMillis;
            const since = yield* freshSince;

            const recent = yield* count(
              "select count(*) as total from help_reports where email_hash = ? and created_at > ?",
              report.emailHash,
              Math.max(since, now - HELP_DAY_MILLIS)
            );

            if (recent >= limits.perAttendeePerDay) {
              return HelpFileOutcome.cases.LimitReached.make({
                limit: "per-attendee",
              });
            }

            const stored = yield* count(
              "select count(*) as total from help_reports where created_at > ?",
              since
            );

            if (stored >= limits.total) {
              return HelpFileOutcome.cases.LimitReached.make({
                limit: "total",
              });
            }

            yield* write(
              `insert into help_reports (${columns}) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, null, null)`,
              report.reportId,
              report.emailHash,
              report.test ? 1 : 0,
              report.step,
              report.symptom,
              report.errorText,
              report.os,
              report.redacted ? 1 : 0,
              report.matched,
              now
            );

            if ((yield* state.storage.getAlarm()) === null) {
              yield* armExpiry;
            }

            return HelpFileOutcome.cases.Filed.make({
              report: {
                ...report,
                answer: null,
                answeredAt: null,
                createdAt: now,
              },
            });
          });

        const answerReport = (reportId: string, text: string) =>
          Effect.gen(function* answerHelpReport() {
            const found = yield* lookup(reportId);

            if (HelpLookup.guards.Missing(found)) {
              return found;
            }

            const now = yield* Clock.currentTimeMillis;

            yield* write(
              "update help_reports set answer = ?, answered_at = ? where id = ?",
              text,
              now,
              reportId
            );

            return HelpLookup.cases.Found.make({
              report: { ...found.report, answer: text, answeredAt: now },
            });
          });

        const listReports = (query: typeof HelpListQuery.Type) =>
          Effect.gen(function* listHelpReports() {
            const since = yield* freshSince;

            const after =
              query.cursor === null
                ? undefined
                : Option.getOrUndefined(decodeCursor(query.cursor));

            const conditions = [
              "created_at > ?",
              ...(query.unansweredOnly ? ["answer is null"] : []),
              ...(query.tests === "include"
                ? []
                : [query.tests === "only" ? "test = 1" : "test = 0"]),
              ...(after === undefined
                ? []
                : ["(created_at < ? or (created_at = ? and id < ?))"]),
            ];

            const page = yield* rows(
              `select ${columns} from help_reports where ${conditions.join(" and ")} order by created_at desc, id desc limit ?`,
              since,
              ...(after === undefined
                ? []
                : [after.createdAt, after.createdAt, after.id]),
              query.limit + 1
            );

            const reports = page.slice(0, query.limit);
            const last = reports.at(-1);

            return {
              cursor:
                page.length > query.limit && last !== undefined
                  ? encodeCursor({
                      createdAt: last.createdAt,
                      id: last.reportId,
                    })
                  : null,
              reports,
            };
          });

        const expireReports = Effect.gen(function* expireReports() {
          const since = yield* freshSince;

          yield* write("delete from help_reports where created_at <= ?", since);
          yield* armExpiry;
        });

        return {
          alarm: () => expireReports,
          answer: (reportId: string, text: string) =>
            run(
              state.storage
                .transaction(answerReport(reportId, text))
                .pipe(Effect.orDie)
            ),
          file: (report: typeof NewHelpReport.Type) =>
            run(
              state.storage.transaction(fileReport(report)).pipe(Effect.orDie)
            ),
          find: (reportId: string) => run(lookup(reportId)),
          list: (query: typeof HelpListQuery.Type) => run(listReports(query)),
        };
      });
    })
  ) {}

  return HelpDeskDefinition;
};

export const WorkshopHelpDesk = defineHelpDesk(
  "WorkshopHelpDesk",
  productionHelpLimits
);
