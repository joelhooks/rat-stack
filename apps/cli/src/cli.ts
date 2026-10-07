#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Approval } from "@rat-stack/capability";
import { FileInspector } from "@rat-stack/core";
import { Console, Effect, Layer } from "effect";

import { runCommand } from "./command.js";
import { remoteJoinInterestLayer } from "./join-interest.js";
import { localLearnerProgressLayer } from "./learn-store.js";
import { remoteLearnerLayer } from "./learn.js";

const program = runCommand(process.argv.slice(2)).pipe(
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Oxlint mistakes this Effect handler for an async Promise callback.
  Effect.catchTag("FileStatsError", (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.fail(error)))
  ),
  Effect.provide(
    Layer.mergeAll(
      Layer.provideMerge(FileInspector.layer, NodeServices.layer),
      remoteJoinInterestLayer,
      localLearnerProgressLayer.pipe(
        Layer.provideMerge(remoteLearnerLayer),
        Layer.provide(NodeServices.layer)
      ),
      Approval.denyAll
    )
  )
);

NodeRuntime.runMain(program);
