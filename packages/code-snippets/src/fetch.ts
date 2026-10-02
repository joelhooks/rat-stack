import type { Schema } from "effect";
import { Effect, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

import { CodeBuildFailed, CodeUnknownRepo, formatCodeError } from "./errors.ts";
import { SourceFetchMissingCommit } from "./errors/source-fetch-missing-commit.ts";
import { SourceFetchOffline } from "./errors/source-fetch-offline.ts";
import { SourceFetchUnknownRemote } from "./errors/source-fetch-unknown-remote.ts";
import { errorContext } from "./model.ts";
import type { FenceJob } from "./pipeline.ts";
import { decodeRepositories } from "./repositories.ts";
import { parseCodeRequest } from "./scanner.ts";

export { SourceFetchMissingCommit } from "./errors/source-fetch-missing-commit.ts";

export { SourceFetchOffline } from "./errors/source-fetch-offline.ts";

export { SourceFetchUnknownRemote } from "./errors/source-fetch-unknown-remote.ts";

export const fetchSources = Effect.fn("fetchSources")(function* fetchSources(
  jobs: readonly FenceJob[],
  configuration: Schema.Json
) {
  const entries = yield* decodeRepositories(configuration);
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const attempted = new Set<string>();

  return yield* Effect.validate(jobs, (job) =>
    Effect.gen(function* fetchPin() {
      const request = yield* parseCodeRequest(job.node, job.sourcePath);

      if (!request.reference) {
        return null;
      }

      const pin = JSON.stringify([request.repo, request.commit]);

      if (attempted.has(pin)) {
        return null;
      }

      attempted.add(pin);

      const entry = entries.find((item) => item.id === request.repo);

      if (entry === undefined) {
        return yield* new CodeUnknownRepo(
          errorContext(
            request,
            "Use an id from the configured repository registry."
          )
        );
      }

      const context = (fix: string) => ({
        commit: request.commit,
        fix,
        line: request.line,
        repo: request.repo,
        sourcePath: request.sourcePath,
      });

      const present = yield* spawner
        .exitCode(
          ChildProcess.make("git", [
            "-C",
            entry.location,
            "cat-file",
            "-e",
            `${request.commit}^{commit}`,
          ])
        )
        .pipe(
          Effect.mapError(
            () =>
              new SourceFetchOffline(
                context(
                  "Local Git is unavailable; install Git and check the configured repository."
                )
              )
          )
        );

      if (present === 0) {
        return { commit: request.commit, fetched: false, repo: request.repo };
      }

      if (entry.remote === undefined) {
        return yield* new SourceFetchUnknownRemote(
          context(
            "Configure remote for this repository before running pnpm sources:fetch."
          )
        );
      }

      const handle = yield* spawner
        .spawn(
          ChildProcess.make("git", [
            "-C",
            entry.location,
            "fetch",
            "--depth=1",
            "--",
            entry.remote,
            request.commit,
          ])
        )
        .pipe(
          Effect.mapError(
            () =>
              new SourceFetchOffline(
                context(
                  "Fetch could not start; check Git, the configured remote and connectivity."
                )
              )
          )
        );

      const stderr = yield* handle.stderr
        .pipe(Stream.decodeText(), Stream.mkString)
        .pipe(
          Effect.mapError(
            () =>
              new SourceFetchOffline(
                context(
                  "Could not read the fetch result; check Git and connectivity."
                )
              )
          )
        );

      const status = yield* handle.exitCode.pipe(
        Effect.mapError(
          () =>
            new SourceFetchOffline(
              context(
                "Fetch did not exit normally; check connectivity and retry pnpm sources:fetch."
              )
            )
        )
      );

      if (status !== 0) {
        if (
          stderr.includes("not our ref") ||
          stderr.includes("couldn't find remote ref")
        ) {
          return yield* new SourceFetchMissingCommit(
            context(
              "The configured remote has no requested SHA; correct at or remote."
            )
          );
        }

        return yield* new SourceFetchOffline(
          context(
            "Fetch failed; check the configured remote, authentication and connectivity, then retry pnpm sources:fetch."
          )
        );
      }

      const verified = yield* spawner
        .exitCode(
          ChildProcess.make("git", [
            "-C",
            entry.location,
            "cat-file",
            "-e",
            `${request.commit}^{commit}`,
          ])
        )
        .pipe(
          Effect.mapError(
            () =>
              new SourceFetchOffline(
                context(
                  "Could not verify fetched objects; check the local Git repository."
                )
              )
          )
        );

      if (verified !== 0) {
        return yield* new SourceFetchMissingCommit(
          context(
            "Fetch exited successfully without the pinned commit; correct at or remote."
          )
        );
      }

      return { commit: request.commit, fetched: true, repo: request.repo };
    }).pipe(Effect.scoped)
  ).pipe(
    Effect.mapError(
      (errors) =>
        new CodeBuildFailed({
          failures: errors,
          messages: errors.map((error) =>
            "actualLength" in error ? formatCodeError(error) : error.message
          ),
        })
    )
  );
});
