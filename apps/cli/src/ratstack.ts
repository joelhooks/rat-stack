import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Approval } from "@rat-stack/capability";
import { Effect, Layer } from "effect";

import { localLearnLayer } from "./learn-layer.js";
import { runRatstack } from "./ratstack-command.js";

const program = runRatstack(process.argv.slice(2)).pipe(
  Effect.provide(
    Layer.mergeAll(NodeServices.layer, localLearnLayer, Approval.denyAll)
  )
);

NodeRuntime.runMain(program);
