import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { toCommand } from "@rat-stack/capability";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/cli";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { capabilities } from "./capabilities.js";
import { localLayer } from "./local.js";
import { RollbackRunner } from "./rollback-runner.js";
import { WorkerDeployments } from "./worker-deployments.js";

const root = Command.make("deploy").pipe(
  Command.withSubcommands(
    capabilities.map((capability) => toCommand(capability))
  )
);

const shellArgument = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

const program = Command.runWith(root, { version: "0.1.0" })(
  process.argv.slice(2)
).pipe(
  Effect.catchTag("DeployNotHealthy", (failure) =>
    Console.log(JSON.stringify(failure.verdict)).pipe(
      Effect.andThen(
        failure.verdict.receipt?.profile === undefined
          ? Effect.void
          : Console.log(
              `Recovery requires approval: pnpm deploy:rollback --profile ${shellArgument(failure.verdict.receipt.profile)} --receipt ${shellArgument(`.rat/deploy/${encodeURIComponent(failure.verdict.receipt.profile)}/last-apply.json`)} --yes`
            )
      ),
      Effect.andThen(Effect.fail(failure))
    )
  ),
  Effect.catchTag("RollbackFailed", (failure) =>
    Console.log(JSON.stringify(failure.receipt)).pipe(
      Effect.andThen(Effect.fail(failure))
    )
  ),
  Effect.catchTag("RollbackRefused", (failure) =>
    Console.log(JSON.stringify({ reason: failure.reason })).pipe(
      Effect.andThen(Effect.fail(failure))
    )
  ),
  Effect.provide(
    RollbackRunner.layer("https://ratstack.sh").pipe(
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
        Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)
      )
    )
  ),
  Effect.scoped
);

NodeRuntime.runMain(program);
