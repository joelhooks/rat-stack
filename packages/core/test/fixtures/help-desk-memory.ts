import { Effect, Layer, Ref } from "effect";

import { HelpFileOutcome, HelpLookup } from "../../src/tokenmaxx-help-store.js";
import type { StoredHelpReport } from "../../src/tokenmaxx-help-store.js";
import { SetupHelpDesk } from "../../src/tokenmaxx-help.js";

type Report = typeof StoredHelpReport.Type;

export const memoryHelpDesk = Effect.gen(function* memoryHelpDesk() {
  const reports = yield* Ref.make<readonly Report[]>([]);

  const lookup = (reportId: string) =>
    Ref.get(reports).pipe(
      Effect.map((all) => {
        const report = all.find((candidate) => candidate.reportId === reportId);

        return report === undefined
          ? HelpLookup.cases.Missing.make({})
          : HelpLookup.cases.Found.make({ report });
      })
    );

  const layer = Layer.succeed(SetupHelpDesk, {
    answer: (reportId, answer) =>
      Ref.modify(
        reports,
        (all): readonly [typeof HelpLookup.Type, readonly Report[]] => {
          const index = all.findIndex(
            (candidate) => candidate.reportId === reportId
          );

          const found = all[index];

          if (found === undefined) {
            return [HelpLookup.cases.Missing.make({}), all];
          }

          const report = { ...found, answer, answeredAt: found.createdAt + 1 };

          return [
            HelpLookup.cases.Found.make({ report }),
            all.with(index, report),
          ];
        }
      ),
    file: (report) =>
      Ref.modify(reports, (all) => {
        const stored = {
          ...report,
          answer: null,
          answeredAt: null,
          createdAt: all.length,
        };

        return [
          HelpFileOutcome.cases.Filed.make({ report: stored }),
          [...all, stored],
        ];
      }),
    find: lookup,
    list: (query) =>
      Ref.get(reports).pipe(
        Effect.map((all) => ({
          cursor: null,
          reports: all
            .filter(
              (report) =>
                (!query.unansweredOnly || report.answer === null) &&
                (query.tests === "include" ||
                  report.test === (query.tests === "only"))
            )
            .toReversed()
            .slice(0, query.limit),
        }))
      ),
  });

  return { layer, stored: Ref.get(reports) };
});
