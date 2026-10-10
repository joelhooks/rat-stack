import { Effect, FileSystem, Path } from "effect";

import { ContentMigrationIssue } from "./content-migration.ts";
import { writeFileAtomically } from "./write-file-atomically.ts";

export interface MigrationCandidateFile {
  readonly content: string;
  readonly filename: string;
}

export const publishMigrationCandidates = Effect.fn(
  "publishMigrationCandidates"
)(function* publishMigrationCandidates(
  files: readonly MigrationCandidateFile[]
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  const planned = yield* Effect.validate(files, (file) =>
    Effect.gen(function* preflightCandidate() {
      if (!(yield* fs.exists(file.filename))) {
        return { ...file, missing: true };
      }

      const existing = yield* fs.readFileString(file.filename);

      if (existing !== file.content) {
        return yield* new ContentMigrationIssue({
          construct: "existing candidate",
          line: 1,
          repair:
            "Use an empty report directory; a different candidate is never overwritten.",
          sourcePath: file.filename,
        });
      }

      return { ...file, missing: false };
    })
  );

  for (const file of planned) {
    if (file.missing) {
      yield* fs.makeDirectory(path.dirname(file.filename), { recursive: true });
      yield* writeFileAtomically(file.filename, file.content);
    }
  }
});
