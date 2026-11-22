import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { SetupProblemReport } from "@rat-stack/core/tokenmaxx-help-contracts";
import { Console, Effect, FileSystem, Layer, Schema } from "effect";
import { FetchHttpClient } from "effect/http";

import { Origin, operatorCall } from "./help-desk-client.ts";

const Arguments = Schema.Struct({
  file: Schema.NonEmptyString,
  origin: Origin,
  reportId: Schema.NonEmptyString,
});

const program = Effect.gen(function* answerReport() {
  const { file, origin, reportId } = yield* Schema.decodeUnknownEffect(
    Arguments
  )({
    file: process.argv[3],
    origin: process.argv[4] ?? "https://ratstack.sh",
    reportId: process.argv[2],
  });

  const fs = yield* FileSystem.FileSystem;
  const answer = (yield* fs.readFileString(file)).trim();

  const report = yield* operatorCall(
    origin,
    "answerSetupProblem",
    { answer, reportId },
    SetupProblemReport
  );

  yield* Console.log(JSON.stringify(report));
}).pipe(
  Effect.provide(Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer))
);

NodeRuntime.runMain(program);
