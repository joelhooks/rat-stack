import { NodeCrypto, NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Path } from "effect";

import { historyArgs } from "./daily-log.ts";
import { openGitSnapshot } from "./git-snapshot.ts";

const check = Effect.gen(function* checkGitHistory() {
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");
  const snapshot = yield* openGitSnapshot(root, false);

  yield* snapshot.query(historyArgs);
});

NodeRuntime.runMain(
  check.pipe(Effect.provide([NodeServices.layer, NodeCrypto.layerDigest]))
);
