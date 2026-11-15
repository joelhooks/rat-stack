import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { SetupProblemPage } from "@rat-stack/core/tokenmaxx-help-contracts";
import { Console, Effect, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { Origin, operatorCall } from "./help-desk-client.ts";

const Arguments = Schema.Struct({
  origin: Origin,
  tests: Schema.Literals(["exclude", "include", "only"]),
});

const pageLimit = 100;

const maxPages = 50;

const program = Effect.gen(function* listUnansweredReports() {
  const { origin, tests } = yield* Schema.decodeUnknownEffect(Arguments)({
    origin: process.argv[2],
    tests: process.argv[3] ?? "exclude",
  });

  const firstPage = { limit: pageLimit, tests, unansweredOnly: true };
  const cursors: (string | null)[] = [null];

  for (const cursor of cursors) {
    const page = yield* operatorCall(
      origin,
      "listSetupProblems",
      cursor === null ? firstPage : { ...firstPage, cursor },
      SetupProblemPage
    );

    for (const report of page.reports) {
      yield* Console.log(JSON.stringify(report));
    }

    if (page.cursor !== null && cursors.length < maxPages) {
      cursors.push(page.cursor);
    }
  }
}).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
);

NodeRuntime.runMain(program);
