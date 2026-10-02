import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const RootManifest = Schema.fromJsonString(
  Schema.Struct({
    packageManager: Schema.String,
    scripts: Schema.Struct({ "lockfile:check": Schema.String }),
  })
);

it.layer(NodeServices.layer)("lockfile guard", (test) => {
  test.effect(
    "rejects duplicate keys even with a warm install cache, without repairing them",
    () =>
      Effect.gen(function* verifiesFrozenLockfileGuard() {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = path.resolve(import.meta.dirname, "../../..");
        const directory = yield* fileSystem.makeTempDirectoryScoped();

        const manifest = yield* Schema.decodeEffect(RootManifest)(
          yield* fileSystem.readFileString(path.join(root, "package.json"))
        );

        yield* fileSystem.writeFileString(
          path.join(directory, "package.json"),
          JSON.stringify({
            devDependencies: { "warm-fixture": "file:./warm-fixture" },
            name: "lockfile-guard-fixture",
            packageManager: manifest.packageManager,
            private: true,
          })
        );

        yield* fileSystem.writeFileString(
          path.join(directory, "pnpm-workspace.yaml"),
          "packages: []\n"
        );

        yield* fileSystem.makeDirectory(path.join(directory, "warm-fixture"));
        yield* fileSystem.writeFileString(
          path.join(directory, "warm-fixture/package.json"),
          JSON.stringify({ name: "warm-fixture", version: "1.0.0" })
        );

        const installed = yield* spawner.exitCode(
          ChildProcess.make(
            "pnpm",
            ["install", "--offline", "--ignore-scripts"],
            { cwd: directory }
          )
        );

        expect(installed).toBe(0);

        const lockfile = path.join(directory, "pnpm-lock.yaml");
        const valid = yield* fileSystem.readFileString(lockfile);

        const guard = ChildProcess.make(
          "bash",
          ["-c", manifest.scripts["lockfile:check"]],
          { cwd: directory }
        );

        expect(yield* spawner.exitCode(guard)).toBe(0);
        expect(yield* fileSystem.readFileString(lockfile)).toBe(valid);

        const duplicate = `${valid}\nlockfileVersion: '9.0'\n`;

        yield* fileSystem.writeFileString(lockfile, duplicate);

        expect(yield* spawner.exitCode(guard)).not.toBe(0);
        expect(yield* fileSystem.readFileString(lockfile)).toBe(duplicate);
      })
  );
});
