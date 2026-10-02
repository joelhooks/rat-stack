import { Effect, Layer } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import type { RepositoryRegistry } from "./ports.ts";
import {
  CodeRepositoryConfigInvalid,
  SourceFault,
  SourceRepository,
  decodeRepositories,
} from "./ports.ts";

export const gitLayer = (input: typeof RepositoryRegistry.Encoded) =>
  Layer.effect(
    SourceRepository,
    Effect.gen(function* makeSourceRepository() {
      const repositories = yield* decodeRepositories(input);

      for (const entry of repositories) {
        if (entry.adapter !== "git") {
          return yield* new CodeRepositoryConfigInvalid({
            fix: `Use adapter git for ${entry.id}; no other source adapter is installed.`,
          });
        }
      }

      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const blobs = new Map<string, string>();

      const read = Effect.fn("SourceRepository.resolve")(function* read(
        repo: string,
        commit: string,
        path: string
      ) {
        const entry = repositories.find((item) => item.id === repo);

        if (entry === undefined) {
          return yield* new SourceFault({ kind: "repo" });
        }

        const command = (args: readonly string[]) =>
          ChildProcess.make("git", ["-C", entry.location, ...args]);

        const key = JSON.stringify([repo, commit, path]);

        const pinned =
          commit.length === 40 &&
          Array.from(commit, (char) =>
            "0123456789abcdef".includes(char.toLowerCase())
          ).every(Boolean);

        const cached = pinned ? blobs.get(key) : undefined;

        if (cached !== undefined) {
          return cached;
        }

        const inside = yield* spawner
          .exitCode(command(["rev-parse", "--git-dir"]))
          .pipe(
            Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
          );

        if (inside !== 0) {
          return yield* new SourceFault({ kind: "unavailable" });
        }

        const exists = yield* spawner
          .exitCode(command(["cat-file", "-e", `${commit}^{commit}`]))
          .pipe(
            Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
          );

        if (exists !== 0) {
          const shallow = yield* spawner
            .string(command(["rev-parse", "--is-shallow-repository"]))
            .pipe(
              Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
            );

          return yield* new SourceFault({
            kind: shallow.trim() === "true" ? "unavailable" : "commit",
          });
        }

        const object = `${commit}:${path}`;

        const type = yield* spawner
          .string(command(["cat-file", "-t", object]))
          .pipe(
            Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
          );

        if (type.trim() !== "blob") {
          return yield* new SourceFault({ kind: "path" });
        }

        const text = yield* spawner
          .string(command(["show", object]))
          .pipe(
            Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
          );

        if (pinned) {
          blobs.set(key, text);
        }

        return text;
      });

      return SourceRepository.of({ repositories, resolve: read });
    })
  );
