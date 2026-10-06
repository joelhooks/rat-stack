import {
  SourceFault,
  SourceRepository,
  decodeRepositories,
  parseCodeRequest,
} from "@rat-stack/code-snippets";
import type { FenceJob } from "@rat-stack/code-snippets";
import {
  Crypto,
  Effect,
  FileSystem,
  Layer,
  Path,
  Result,
  Schema,
} from "effect";
import { Hex } from "effect/encoding";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { codeRepositories } from "./code-config.ts";

const snapshotPath = ".brain/data/git-snapshot.json";

const Snapshot = Schema.Struct({
  files: Schema.Record(Schema.String, Schema.String),
  queries: Schema.Record(Schema.String, Schema.String),
  version: Schema.Literal(1),
});

export class GitSnapshotError extends Schema.TaggedError<GitSnapshotError>()(
  "GitSnapshotError",
  { entry: Schema.String, reason: Schema.String }
) {
  override get message() {
    return `${this.reason}: ${this.entry}. Run pnpm git-snapshot in a full checkout.`;
  }
}

export const openGitSnapshot = Effect.fn("openGitSnapshot")(
  function* openSnapshot(root: string, regenerate: boolean) {
    const fs = yield* FileSystem.FileSystem;
    const crypto = yield* Crypto.Crypto;

    const hash = (algorithm: Crypto.DigestAlgorithm, text: string) =>
      crypto
        .digest(algorithm, new TextEncoder().encode(text))
        .pipe(Effect.map(Hex.encode));

    const path = yield* Path.Path;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const command = (args: readonly string[]) =>
      ChildProcess.make("git", args, { cwd: root });

    const inside = yield* spawner.exitCode(command(["rev-parse", "--git-dir"]));
    const checkout = inside === 0;

    if (regenerate && !checkout) {
      return yield* new GitSnapshotError({
        entry: snapshotPath,
        reason: "Snapshot generation requires Git",
      });
    }

    if (checkout) {
      const shallow = yield* spawner.string(
        command(["rev-parse", "--is-shallow-repository"])
      );

      if (shallow.trim() !== "false") {
        return yield* new GitSnapshotError({
          entry: snapshotPath,
          reason: "Full Git history is required",
        });
      }
    }

    const loaded = regenerate
      ? ({ files: {}, queries: {}, version: 1 } satisfies typeof Snapshot.Type)
      : yield* fs.readFileString(path.join(root, snapshotPath)).pipe(
          Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Snapshot))),
          Effect.mapError(
            () =>
              new GitSnapshotError({
                entry: snapshotPath,
                reason: "Missing or invalid snapshot",
              })
          )
        );

    const queries = new Map(Object.entries(loaded.queries));
    const files = new Map(Object.entries(loaded.files));

    const query = Effect.fn("GitSnapshot.query")(function* queryGit(
      args: readonly string[]
    ) {
      const key = JSON.stringify(["rat-stack", ...args]);
      const stored = queries.get(key);

      if (!regenerate && stored === undefined) {
        return yield* new GitSnapshotError({
          entry: key,
          reason: "Missing snapshot entry",
        });
      }

      if (!checkout) {
        if (stored === undefined) {
          return yield* new GitSnapshotError({
            entry: key,
            reason: "Missing snapshot entry",
          });
        }

        return stored;
      }

      const status = yield* spawner
        .exitCode(command(args))
        .pipe(
          Effect.mapError(
            () =>
              new GitSnapshotError({ entry: key, reason: "Git query failed" })
          )
        );

      if (status !== 0) {
        return yield* new GitSnapshotError({
          entry: key,
          reason: "Git query failed",
        });
      }

      const actual = yield* spawner
        .string(command(args))
        .pipe(
          Effect.mapError(
            () =>
              new GitSnapshotError({ entry: key, reason: "Git query failed" })
          )
        );

      if (!regenerate && actual !== stored) {
        return yield* new GitSnapshotError({
          entry: key,
          reason: "Stale snapshot entry",
        });
      }

      queries.set(key, actual);

      return actual;
    });

    const track = Effect.fn("GitSnapshot.track")(function* trackSource(
      sourcePath: string
    ) {
      const text = yield* fs.readFileString(path.join(root, sourcePath)).pipe(
        Effect.mapError(
          () =>
            new GitSnapshotError({
              entry: sourcePath,
              reason: "Cannot read tracked source",
            })
        )
      );

      const actual = yield* hash("SHA-256", text);

      if (!regenerate && files.get(sourcePath) !== actual) {
        return yield* new GitSnapshotError({
          entry: sourcePath,
          reason: "Stale or missing source fingerprint",
        });
      }

      files.set(sourcePath, actual);

      return actual;
    });

    const resolve = Effect.fn("GitSnapshot.resolve")(function* resolveSource(
      repo: string,
      commit: string,
      sourcePath: string
    ) {
      if (repo !== "rat-stack") {
        return yield* new GitSnapshotError({
          entry: repo,
          reason: "Unknown snapshot repository",
        });
      }

      if (commit === "HEAD") {
        yield* track(sourcePath);

        return yield* query(["show", `HEAD:${sourcePath}`]);
      }

      yield* track(sourcePath);
      const object = `${commit}:${sourcePath}`;
      const text = yield* query(["show", object]);
      const blob = yield* query(["rev-parse", object]);

      if (
        blob.trim() !==
        (yield* hash(
          "SHA-1",
          `blob ${new TextEncoder().encode(text).length}\0${text}`
        ))
      ) {
        return yield* new GitSnapshotError({
          entry: `${repo}:${object}`,
          reason: "Snapshot blob checksum mismatch",
        });
      }

      return text;
    });

    const repositories = yield* decodeRepositories(codeRepositories(root));

    const sourceLayer = Layer.succeed(
      SourceRepository,
      SourceRepository.of({
        repositories,
        resolve: (repo, commit, sourcePath) =>
          resolve(repo, commit, sourcePath).pipe(
            Effect.mapError(() => new SourceFault({ kind: "unavailable" }))
          ),
      })
    );

    const save = regenerate
      ? Effect.suspend(() =>
          fs
            .writeFileString(
              path.join(root, snapshotPath),
              `${JSON.stringify({ files: Object.fromEntries([...files].toSorted(([a], [b]) => a.localeCompare(b))), queries: Object.fromEntries([...queries].toSorted(([a], [b]) => a.localeCompare(b))), version: 1 }, null, 2)}\n`
            )
            .pipe(
              Effect.mapError(
                () =>
                  new GitSnapshotError({
                    entry: snapshotPath,
                    reason: "Snapshot write failed",
                  })
              )
            )
        )
      : Effect.void;

    const verifyFences = Effect.fn("GitSnapshot.verifyFences")(
      function* verifyFences(fences: readonly FenceJob[]) {
        const failures: string[] = [];

        for (const fence of fences) {
          const result = yield* parseCodeRequest(
            fence.node,
            fence.sourcePath
          ).pipe(
            Effect.flatMap((request) =>
              request.reference
                ? resolve(request.repo, request.commit, request.path).pipe(
                    Effect.asVoid
                  )
                : Effect.void
            ),
            Effect.result
          );

          if (Result.isFailure(result)) {
            failures.push(result.failure.message);
          }
        }

        if (failures.length > 0) {
          return yield* new GitSnapshotError({
            entry: failures.join("\n"),
            reason: "Code snapshot preflight failed",
          });
        }

        return failures;
      }
    );

    return { query, resolve, save, sourceLayer, track, verifyFences };
  }
);
