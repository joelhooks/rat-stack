import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { ContentAssetManifest } from "../src/asset-manifest.ts";

class DirectBuildFailed extends Schema.TaggedError<DirectBuildFailed>()(
  "DirectBuildFailed",
  { reason: Schema.String }
) {}

const outputs = [
  "src/bundled-content.generated.ts",
  "src/rat-icons.generated.ts",
  "dist/content",
];

const restoreOutputs = (app: string, backup: string) =>
  Effect.gen(function* restoreGeneratedOutputs() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    for (const [index, output] of outputs.entries()) {
      const saved = path.join(backup, String(index));
      const file = path.join(app, output);

      if (yield* fs.exists(saved)) {
        if (yield* fs.exists(file)) {
          yield* fs.rename(file, path.join(backup, `failed-${index}`));
        }

        yield* fs.rename(saved, file);
      }
    }
  });

const verifyBuild = (app: string) =>
  Effect.gen(function* verifyDirectBuild() {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const handle = yield* spawner.spawn(
      ChildProcess.make("pnpm", ["build"], {
        cwd: app,
        env: { TURBO_HASH: "" },
        extendEnv: true,
        stderr: "inherit",
        stdin: "inherit",
        stdout: "inherit",
      })
    );

    yield* handle.exitCode.pipe(
      Effect.filterOrFail(
        (code) => code === 0,
        () =>
          new DirectBuildFailed({
            reason: "Direct build failed from missing generated outputs.",
          })
      )
    );

    const manifestText = yield* fs.readFileString(
      path.join(app, "dist/content/manifest.json")
    );

    const manifest = yield* Schema.decodeEffect(
      Schema.fromJsonString(ContentAssetManifest)
    )(manifestText);

    const runtimeText = yield* fs.readFileString(
      path.join(app, "src/bundled-content.generated.ts")
    );

    if (!runtimeText.includes(JSON.stringify(manifest.generation))) {
      return yield* new DirectBuildFailed({
        reason:
          "Direct build produced mismatched manifest and runtime generation.",
      });
    }

    return yield* Effect.logInfo(
      "DIRECT_BUILD_CURRENT: direct build recreated matching content and runtime from missing outputs."
    );
  });

const program = Effect.gen(function* checkDirectBuild() {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const app = new URL("../", import.meta.url).pathname;

  const backup = yield* fs.makeTempDirectoryScoped();

  for (const [index, output] of outputs.entries()) {
    const file = path.join(app, output);

    if (yield* fs.exists(file)) {
      yield* fs.rename(file, path.join(backup, String(index)));
    }
  }

  yield* verifyBuild(app).pipe(
    Effect.onError(() => restoreOutputs(app, backup).pipe(Effect.orDie))
  );
});

NodeRuntime.runMain(
  program.pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
