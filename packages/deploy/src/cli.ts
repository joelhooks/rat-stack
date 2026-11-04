import { NodeRuntime } from "@effect/platform-node";
import { toCommand } from "@rat-stack/capability";
import { PlatformServices } from "alchemy/Util/PlatformServices";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/cli";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { capabilities } from "./capabilities.js";
import { localLayer } from "./local.js";
import { refusalGuide } from "./refusals.js";
import { RollbackRunner } from "./rollback-runner.js";
import { stateStoresLayer } from "./state-stores.js";
import { lingeringWatchHost, WatchHost } from "./watch-host.js";
import { watchFailure } from "./watch-receipt.js";
import { WorkerDeployments } from "./worker-deployments.js";

const root = Command.make("deploy").pipe(
  Command.withSubcommands(
    capabilities.map((capability) => toCommand(capability))
  )
);

const shellArgument = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const settleWatches = Effect.gen(function* settleWatches() {
  const host = yield* WatchHost;

  if ((yield* host.pending) > 0) {
    yield* Console.error(
      "Post-deploy watch running with rollback armed. Leave this process running; its receipt prints here and in .rat/deploy/<profile>/last-watch.json."
    );
  }

  const receipts = yield* host.settle;

  yield* Effect.forEach(
    receipts,
    (receipt) => Console.log(JSON.stringify(receipt)),
    { discard: true }
  );

  const [failure] = receipts.flatMap((receipt) => {
    const failed = watchFailure(receipt);

    return failed === undefined ? [] : [failed];
  });

  return yield* failure === undefined ? Effect.void : Effect.fail(failure);
});

const program = Command.runWith(root, { version: "0.1.0" })(
  process.argv.slice(2)
).pipe(
  Effect.andThen(settleWatches),
  Effect.catchTags({
    DeployNotHealthy: (failure) =>
      Console.log(JSON.stringify(failure.report)).pipe(
        Effect.andThen(
          failure.report.rollbackReceipt === undefined
            ? Effect.void
            : Console.log(
                `Recovery requires approval: pnpm deploy:rollback --profile ${shellArgument(failure.report.profile)} --receipt ${shellArgument(failure.report.rollbackReceipt)} --yes`
              )
        ),
        Effect.andThen(Effect.fail(failure))
      ),
    DeployWatchFailed: (failure) =>
      Console.error(failure.message).pipe(Effect.andThen(Effect.fail(failure))),
    RollbackFailed: (failure) =>
      Console.log(JSON.stringify(failure.receipt)).pipe(
        Effect.andThen(Effect.fail(failure))
      ),
    RollbackRefused: (failure) =>
      Console.log(
        JSON.stringify({
          fix: refusalGuide(failure.reason).fix,
          reason: failure.reason,
        })
      ).pipe(Effect.andThen(Effect.fail(failure))),
    StateCopyRefused: (failure) =>
      Console.log(
        JSON.stringify({
          detail: failure.detail,
          fix: failure.fix,
          reason: failure.reason,
          stacks: failure.stacks,
        })
      ).pipe(Effect.andThen(Effect.fail(failure))),
  }),
  Effect.provide(
    RollbackRunner.layer("https://ratstack.sh").pipe(
      Layer.merge(stateStoresLayer()),
      Layer.merge(lingeringWatchHost),
      Layer.provideMerge(
        WorkerDeployments.layer("alchemy.run.ts").pipe(
          Layer.provideMerge(
            localLayer(
              "alchemy.run.ts",
              "../../.env.schema",
              "https://ratstack.sh"
            )
          )
        )
      ),
      Layer.provideMerge(
        Layer.mergeAll(FetchHttpClient.layer, PlatformServices)
      )
    )
  ),
  Effect.scoped
);

NodeRuntime.runMain(program);
