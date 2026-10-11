import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import {
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Path,
  Predicate,
  Schema,
} from "effect";
import { Hex } from "effect/encoding";
import { ChildProcessSpawner } from "effect/process";

import { openGitSnapshot } from "../scripts/git-snapshot.ts";

const commit = "a".repeat(40);

it.layer(NodeServices.layer)("snapshot source boundary", (test) => {
  test.effect.prop(
    "an exported tree preserves pinned blobs and refuses missing or stale inputs",
    { text: Schema.String },
    ({ text }) =>
      Effect.gen(function* exportedBlobRoundTrip() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const root = yield* fs.makeTempDirectoryScoped();
        yield* fs.makeDirectory(path.join(root, ".brain/data"), {
          recursive: true,
        });
        yield* fs.writeFileString(path.join(root, "example.ts"), text);
        const base = yield* ChildProcessSpawner.ChildProcessSpawner;
        const crypto = yield* Crypto.Crypto;

        const blob = Hex.encode(
          yield* crypto.digest(
            "SHA-1",
            new TextEncoder().encode(
              `blob ${new TextEncoder().encode(text).length}\0${text}`
            )
          )
        );

        const calls: string[][] = [];

        const provider = (checkout: boolean, history = text) =>
          Layer.succeed(
            ChildProcessSpawner.ChildProcessSpawner,
            ChildProcessSpawner.ChildProcessSpawner.of({
              ...base,
              exitCode: (command) => {
                if (!Predicate.isTagged(command, "StandardCommand")) {
                  return Effect.die(new Error("Unexpected pipeline"));
                }

                calls.push([...command.args]);

                return Effect.succeed(
                  ChildProcessSpawner.ExitCode(checkout ? 0 : 128)
                );
              },
              string: (command) => {
                if (!Predicate.isTagged(command, "StandardCommand")) {
                  return Effect.die(new Error("Unexpected pipeline"));
                }

                calls.push([...command.args]);

                if (command.args.includes("--is-shallow-repository")) {
                  return Effect.succeed("false\n");
                }

                if (command.args[0] === "log") {
                  return Effect.succeed(history);
                }

                return Effect.succeed(
                  command.args[0] === "show" ? text : `${blob}\n`
                );
              },
            })
          );

        const generated = yield* openGitSnapshot(root, true).pipe(
          Effect.provide(provider(true))
        );

        expect(
          yield* generated.resolve("rat-stack", commit, "example.ts")
        ).toBe(text);
        const historyQuery = ["log", "-n", "1", "--", "example.ts"];
        expect(yield* generated.query(historyQuery)).toBe(text);
        yield* generated.save;

        const changedHistoryReader = yield* openGitSnapshot(root, false).pipe(
          Effect.provide(provider(true, `${text}!`))
        );

        const changedHistory = yield* changedHistoryReader
          .query(historyQuery)
          .pipe(Effect.flip);

        expect(changedHistory.entry).toBe(
          JSON.stringify(["rat-stack", ...historyQuery])
        );
        expect(changedHistory.message).toContain("history changed");
        expect(changedHistory.message).toContain("squash or rebase");
        expect(changedHistory.message).toContain("pnpm git-snapshot");
        expect(changedHistory.message).toContain("commit");

        for (const checkout of [true, false]) {
          calls.length = 0;

          const reader = yield* openGitSnapshot(root, false).pipe(
            Effect.provide(provider(checkout))
          );

          expect(yield* reader.resolve("rat-stack", commit, "example.ts")).toBe(
            text
          );

          if (!checkout) {
            expect(calls).toEqual([["rev-parse", "--git-dir"]]);
          }

          const missing = yield* reader
            .query(["log", "--", "missing.ts"])
            .pipe(Effect.flip);

          expect(missing.message).toContain("Missing snapshot entry");
          expect(missing.message).toContain("missing.ts");
        }

        yield* fs.writeFileString(path.join(root, "example.ts"), `${text}!`);

        const reader = yield* openGitSnapshot(root, false).pipe(
          Effect.provide(provider(true))
        );

        const stale = yield* reader
          .resolve("rat-stack", commit, "example.ts")
          .pipe(Effect.flip);

        expect(stale.message).toContain("example.ts");
        expect(stale.message).toContain("pnpm git-snapshot");
      }).pipe(Effect.scoped),
    { arbitrary: { runs: 20 } }
  );
});
