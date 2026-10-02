import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { generateForCommand } from "./content-generation.ts";

class ContentGenerationFailed extends Schema.TaggedError<ContentGenerationFailed>()(
  "ContentGenerationFailed",
  { exitCode: Schema.Int }
) {}

const generate = Effect.gen(function* runContentGenerator() {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const handle = yield* spawner.spawn(
    ChildProcess.make(
      "node",
      [new URL("generate-content.ts", import.meta.url).pathname],
      { stderr: "inherit", stdin: "inherit", stdout: "inherit" }
    )
  );

  yield* handle.exitCode.pipe(
    Effect.filterOrFail(
      (exitCode) => exitCode === 0,
      (exitCode) => new ContentGenerationFailed({ exitCode })
    )
  );
});

NodeRuntime.runMain(
  generateForCommand(generate).pipe(
    Effect.scoped,
    Effect.provide(NodeServices.layer)
  )
);
