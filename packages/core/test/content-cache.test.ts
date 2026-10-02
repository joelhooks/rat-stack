import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

const DryRun = Schema.fromJsonString(
  Schema.Struct({
    tasks: Schema.Array(
      Schema.Struct({ hash: Schema.String, taskId: Schema.String })
    ),
  })
);

const contentInputs = [
  ".brain/resources/lore/cache-probe.svx",
  ".brain/areas/cache-probe.svx",
  ".brain/data/peers.json",
  "skills/cache-probe/SKILL.md",
  "assets/fonts/cache-probe.ttf",
  "AGENTS.md",
  "VISION.md",
  "README.md",
  "vendor/README.md",
  "packages/capability/src/cache-probe.ts",
  "apps/web/cache-probe.config.ts",
  "packages/core/cache-probe.config.ts",
  "scripts/cache-probe.ts",
  "tools/cache-probe.ts",
  "cache-probe.config.ts",
];

const tasks = ["build", "typecheck", "test", "generate", "check"];

it.layer(NodeServices.layer)("content task cache", (test) => {
  test.effect(
    "invalidates content readers, not unrelated root files",
    () =>
      Effect.gen(function* verifiesContentHashes() {
        const fileSystem = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = path.resolve(import.meta.dirname, "../../..");
        const directory = yield* fileSystem.makeTempDirectoryScoped();

        const write = Effect.fnUntraced(function* writeFixture(
          relative: string,
          text: string
        ) {
          const destination = path.join(directory, relative);
          yield* fileSystem.makeDirectory(path.dirname(destination), {
            recursive: true,
          });
          yield* fileSystem.writeFileString(destination, text);
        });

        yield* write(
          "package.json",
          JSON.stringify({
            name: "content-cache-fixture",
            packageManager: "pnpm@11.3.0",
            private: true,
          })
        );
        yield* write(
          "pnpm-workspace.yaml",
          'packages:\n  - "apps/*"\n  - "packages/*"\n'
        );
        yield* write("pnpm-lock.yaml", 'lockfileVersion: "9.0"\n');
        yield* write(
          "apps/mischief/package.json",
          JSON.stringify({
            name: "@rat-stack/mischief",
            scripts: Object.fromEntries(tasks.map((task) => [task, "echo ok"])),
          })
        );
        yield* write(
          "packages/core/package.json",
          JSON.stringify({ name: "@rat-stack/core" })
        );
        yield* write(
          "turbo.json",
          yield* fileSystem.readFileString(path.join(root, "turbo.json"))
        );
        yield* Effect.all(contentInputs.map((input) => write(input, "before")));
        yield* write("scratch/unrelated.txt", "before");

        const hashes = Effect.fnUntraced(function* readHashes() {
          const output = yield* spawner.string(
            ChildProcess.make(
              "node",
              [
                path.join(root, "node_modules/turbo/bin/turbo"),
                "run",
                ...tasks,
                "--filter=@rat-stack/mischief",
                "--dry=json",
              ],
              { cwd: directory }
            )
          );

          const result = yield* Schema.decodeEffect(DryRun)(output);

          return Object.fromEntries(
            result.tasks
              .filter(({ taskId }) => taskId.startsWith("@rat-stack/mischief#"))
              .map(({ hash, taskId }) => [taskId, hash])
          );
        });

        const before = yield* hashes();
        expect(Object.keys(before)).toHaveLength(tasks.length);
        yield* write("scratch/unrelated.txt", "after");
        const unrelated = yield* hashes();
        expect(unrelated["@rat-stack/mischief#build"]).toBe(
          before["@rat-stack/mischief#build"]
        );
        yield* Effect.all(
          contentInputs.map((input) =>
            Effect.gen(function* changesContentInput() {
              yield* write(input, "after");
              const after = yield* hashes();

              for (const task of tasks) {
                const taskId = `@rat-stack/mischief#${task}`;
                expect(after[taskId], `${input}: ${task}`).not.toBe(
                  before[taskId]
                );
              }

              yield* write(input, "before");
            })
          )
        );
      }),
    { timeout: 30_000 }
  );
});
