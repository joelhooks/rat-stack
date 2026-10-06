import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { toCommand } from "@rat-stack/capability";
import { Console, Effect, Layer } from "effect";
import { Command } from "effect/cli";
import * as FetchHttpClient from "effect/http/FetchHttpClient";

import { capabilities } from "./capabilities.js";
import { localLayer } from "./local.js";

const root = Command.make("deploy").pipe(
  Command.withSubcommands(
    capabilities.map((capability) => toCommand(capability))
  )
);

const program = Command.runWith(root, { version: "0.1.0" })(
  process.argv.slice(2)
).pipe(
  Effect.catchTag("DeployNotHealthy", (failure) =>
    Console.log(JSON.stringify(failure.verdict)).pipe(
      Effect.andThen(Effect.fail(failure))
    )
  ),
  Effect.provide(
    localLayer(
      "alchemy.run.ts",
      "../../.env.schema",
      "https://ratstack.sh"
    ).pipe(
      Layer.provideMerge(
        Layer.mergeAll(FetchHttpClient.layer, NodeServices.layer)
      )
    )
  ),
  Effect.scoped
);

NodeRuntime.runMain(program);
