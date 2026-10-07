#!/usr/bin/env node

import { homedir } from "node:os";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Approval } from "@rat-stack/capability";
import { FileInspector } from "@rat-stack/core";
import {
  localLearnerProgressLayer,
  remoteLearnerLayer,
} from "@rat-stack/learn/local";
import { Console, Effect, Layer, Path } from "effect";

import { runCommand } from "./command.js";
import { remoteJoinInterestLayer } from "./join-interest.js";

const localProgressLayer = Layer.unwrap(
  Effect.gen(function* localProgress() {
    const path = yield* Path.Path;

    return localLearnerProgressLayer(path.join(homedir(), ".rat-learn")).pipe(
      Layer.provideMerge(remoteLearnerLayer)
    );
  })
).pipe(Layer.provide(NodeServices.layer));

const program = runCommand(process.argv.slice(2)).pipe(
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Oxlint mistakes this Effect handler for an async Promise callback.
  Effect.catchTag("FileStatsError", (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.fail(error)))
  ),
  Effect.provide(
    Layer.mergeAll(
      Layer.provideMerge(FileInspector.layer, NodeServices.layer),
      remoteJoinInterestLayer,
      localProgressLayer,
      Approval.denyAll
    )
  )
);

NodeRuntime.runMain(program);
