import { NodeCrypto, NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Layer, Path } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { fenceMessage } from "../../../packages/core/test/fixtures/fence-message.js";
import { openGitSnapshot } from "../scripts/git-snapshot.ts";

const services = Layer.mergeAll(NodeServices.layer, NodeCrypto.layerDigest);

const identity = [
  "-c",
  "user.name=snapshot-test",
  "-c",
  "user.email=snapshot-test@example.invalid",
  "-c",
  "commit.gpgsign=false",
];

it.layer(services)("snapshot history guard", (test) => {
  test.effect(
    "accepts a template child that fetched pinned sources shallowly and refuses a truncated clone",
    () =>
      Effect.gen(function* shallowBoundaries() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
        const root = yield* fs.makeTempDirectoryScoped();

        const git = (cwd: string, args: readonly string[]) =>
          spawner.string(
            ChildProcess.make("git", [...identity, ...args], { cwd })
          );

        const commitFile = Effect.fnUntraced(function* commitFile(
          repo: string,
          name: string,
          text: string
        ) {
          yield* fs.writeFileString(path.join(repo, name), text);
          yield* git(repo, ["add", name]);
          yield* git(repo, ["commit", "-q", "-m", text]);
        });

        const source = path.join(root, "source");
        const child = path.join(root, "child");
        const clone = path.join(root, "clone");
        yield* fs.makeDirectory(source);
        yield* fs.makeDirectory(child);

        yield* git(source, ["init", "-q"]);
        yield* commitFile(source, "pinned.ts", "first");
        yield* commitFile(source, "pinned.ts", "second");
        const pinned = (yield* git(source, ["rev-parse", "HEAD"])).trim();

        yield* git(child, ["init", "-q"]);
        yield* commitFile(child, "README.md", "squashed template");
        yield* git(child, [
          "fetch",
          "-q",
          "--depth=1",
          "--",
          `file://${source}`,
          pinned,
        ]);

        expect(
          (yield* git(child, ["rev-parse", "--is-shallow-repository"])).trim()
        ).toBe("true");
        const snapshot = yield* openGitSnapshot(child, true);

        const missing = yield* snapshot
          .query(["show", "0000000000000000000000000000000000000000:pinned.ts"])
          .pipe(Effect.flip);

        expect(missing.message).toContain("pnpm sources:fetch");
        expect(fenceMessage(missing.message)).toBeDefined();

        yield* git(root, [
          "clone",
          "-q",
          "--depth",
          "1",
          `file://${source}`,
          clone,
        ]);
        const refused = yield* openGitSnapshot(clone, true).pipe(Effect.flip);

        expect(refused.message).toContain("Full Git history is required");
        expect(refused.message).toContain("git fetch --unshallow");
        expect(fenceMessage(refused.message)).toBeDefined();
      }),
    { timeout: 30_000 }
  );
});
