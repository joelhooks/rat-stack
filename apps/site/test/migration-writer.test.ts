import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Result } from "effect";

import { publishMigrationCandidates } from "../scripts/migration-writer.ts";

it.effect(
  "repeating a migration preserves candidates and never overwrites a different file",
  () =>
    Effect.gen(function* safePublication() {
      const fs = yield* FileSystem.FileSystem;

      const directory = yield* fs.makeTempDirectoryScoped({
        prefix: "rat-content-migration-",
      });

      const first = `${directory}/first.md`;
      const conflict = `${directory}/second.md`;
      const source = "# Retained\n\nOriginal words.\n";
      yield* publishMigrationCandidates([{ content: source, filename: first }]);
      const originalStat = yield* fs.stat(first);
      yield* publishMigrationCandidates([{ content: source, filename: first }]);
      expect(yield* fs.readFileString(first)).toBe(source);
      expect((yield* fs.stat(first)).mtime).toEqual(originalStat.mtime);
      yield* fs.writeFileString(conflict, "Owned elsewhere\n");

      const result = yield* publishMigrationCandidates([
        { content: "New\n", filename: `${directory}/missing.md` },
        { content: "Wrong\n", filename: conflict },
      ]).pipe(Effect.result);

      expect(Result.isFailure(result)).toBe(true);
      expect(yield* fs.exists(`${directory}/missing.md`)).toBe(false);
      expect(yield* fs.readFileString(conflict)).toBe("Owned elsewhere\n");
    }).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
);
