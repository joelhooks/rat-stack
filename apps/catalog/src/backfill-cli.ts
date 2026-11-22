import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { OperatorApi } from "@rat-stack/catalog/OperatorApi.api";
import {
  Config,
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
  backfillDefectAt,
  BackfillInputError,
  backfillSender,
  defaultBackfillConcurrency,
  listBackfillInputs,
  reportBackfillFailure,
  runBackfill,
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
    concurrency: Flag.Int("concurrency").pipe(
      Flag.withSchema(Schema.Int.check(Schema.isGreaterThanOrEqualTo(1))),
      Flag.withDefault(defaultBackfillConcurrency),
      Flag.withDescription(
        `Maximum items in flight (default ${defaultBackfillConcurrency}, minimum 1).`
      )
    ),
    from: Flag.String("from").pipe(
      Flag.optional,
      Flag.withDescription(
        "Start at this exact input filename, inclusive, in import order."
      )
    ),
  },
  Effect.fnUntraced(function* backfillCommand({
    directory,
    dryRun,
    url,
    concurrency,
    from,
  }) {
    const inputs = yield* listBackfillInputs(
      directory,
      Option.getOrUndefined(from)
    );

    const send = dryRun ? undefined : yield* remoteSender(url);

    yield* runBackfill(directory, inputs, { concurrency, send });
  }, Effect.scoped)
);

const program = Command.run(command, { version: "0.1.0" }).pipe(
  backfillDefectAt("outside file processing"),
  Effect.tapErrorTag("BackfillInputError", reportBackfillFailure),
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
