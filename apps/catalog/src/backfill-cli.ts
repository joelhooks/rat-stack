import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import {
  Config,
  Console,
  Effect,
  Layer,
  Logger,
  Option,
  Redacted,
  Schema,
} from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";

import {
  backfillFiles,
  BackfillInputError,
  listBackfillInputs,
  backfillSender,
} from "./Backfill.ts";
import { smokeTarget } from "./Smoke.ts";

const invalidTarget = () =>
  new BackfillInputError({
    message:
      "Backfill target is missing or invalid. A real run requires a secure operator Api endpoint. Fix: pass `--url <https-url>` or use `--dry-run`.",
  });

const invalidToken = () =>
  new BackfillInputError({
    message:
      "Backfill token is missing or empty. A real run requires operator authorization. Fix: supply `CATALOG_OPERATOR_TOKEN` securely in the environment.",
  });

const remoteSender = Effect.fnUntraced(function* remoteSender(
  url: Option.Option<string>
) {
  const target = yield* Schema.decodeUnknownEffect(smokeTarget)(
    Option.getOrUndefined(url)
  ).pipe(Effect.mapError(invalidTarget));

  const token = yield* Config.Redacted("CATALOG_OPERATOR_TOKEN").pipe(
    Effect.mapError(invalidToken)
  );

  if (Redacted.value(token).length === 0) {
    return yield* invalidToken();
  }

  const api = yield* OperatorApi.clientHttp(target.toString());

  return backfillSender(api, token);
});

const command = Command.make(
  "backfill",
  {
    directory: Argument.String("directory"),
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    url: Flag.String("url").pipe(Flag.optional),
  },
  Effect.fnUntraced(function* runBackfill({ directory, dryRun, url }) {
    const inputs = yield* listBackfillInputs(directory);
    const send = dryRun ? undefined : yield* remoteSender(url);
    const summary = yield* backfillFiles(directory, inputs, send);
    yield* Console.log(JSON.stringify(summary, null, 2));

    if (
      summary.unreadableFile !== null ||
      (summary.delivery?.failed ?? 0) > 0
    ) {
      return yield* new BackfillInputError({
        message:
          "Backfill did not finish cleanly. Some input or commands could not be processed. Fix: check the summary, directory and operator Api, then rerun the same files.",
      });
    }

    return yield* Effect.void;
  }, Effect.scoped)
);

const reportFailure = (error: BackfillInputError) =>
  Console.error(error.message);

const program = Command.run(command, { version: "0.1.0" }).pipe(
  Effect.tapErrorTag("BackfillInputError", reportFailure),
  Effect.catchDefect(() => {
    const error = new BackfillInputError({
      message:
        "Backfill stopped unexpectedly. The run may have committed some commands. Fix: check the inputs and operator Api, then rerun the same files.",
    });

    return Console.error(error.message).pipe(
      Effect.andThen(Effect.fail(error))
    );
  }),
  Effect.withTracerEnabled(false),
  Effect.provideService(FetchHttpClient.RequestInit, {
    redirect: "error",
    cache: "no-store",
  }),
  Effect.provide(
    Layer.mergeAll(NodeServices.layer, FetchHttpClient.layer, Logger.layer([]))
  )
);

NodeRuntime.runMain(program, { disableErrorReporting: true });
