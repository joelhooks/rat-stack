import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { generateForCommand } from "./content-generation.ts";

class ContentGenerationFailed extends Schema.TaggedError<
  ContentGenerationFailed,
  { readonly brand: unique symbol }
>()("ContentGenerationFailed", { exitCode: Schema.Int }) {
  override get message() {
    return `Content generation exited with code ${this.exitCode}. Typecheck, lint, and tests read the generated content, so none of them can run. Fix: read the error above, then rerun \`pnpm --filter @rat-stack/site generate\` until it exits 0.`;
  }
}

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
