#!/usr/bin/env node

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Approval } from "@rat-stack/capability";
import { FileInspector } from "@rat-stack/core";
import { eventFlags, Flags } from "@rat-stack/core/flags";
import { Console, Effect, Layer } from "effect";

import { localCafeDirectoryLayer } from "./cafe.js";
import { runCommand } from "./command.js";
import { remoteJoinInterestLayer } from "./join-interest.js";
import { localLearnLayer } from "./learn-layer.js";
import { localPromptLibraryLayer } from "./prompts.js";

const program = runCommand(process.argv.slice(2)).pipe(
  // oxlint-disable-next-line promise/prefer-await-to-callbacks -- Oxlint mistakes this Effect handler for an async Promise callback.
  Effect.catchTag("FileStatsError", (error) =>
    Console.error(error.message).pipe(Effect.andThen(Effect.fail(error)))
  ),
  Effect.provide(
    Layer.mergeAll(
      Layer.provideMerge(FileInspector.layer, NodeServices.layer),
      remoteJoinInterestLayer,
      localPromptLibraryLayer.pipe(Layer.provide(NodeServices.layer)),
      localCafeDirectoryLayer.pipe(Layer.provide(NodeServices.layer)),
      localLearnLayer,
      Flags.defaults(eventFlags),
      Approval.denyAll
    )
  )
);

NodeRuntime.runMain(program);
