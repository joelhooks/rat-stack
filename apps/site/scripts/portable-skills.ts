// @effect-diagnostics-next-line nodeBuiltinImport:off -- Build-time versions use the same SHA-256 implementation as the asset manifest.
import { createHash } from "node:crypto";

import type { SkillBundle } from "@rat-stack/capability/skill-bundle";
import { Effect, FileSystem, Path } from "effect";
import { forEach as forEachEffect } from "effect/Effect";
import type { PlatformError } from "effect/PlatformError";

import { buildError } from "./content-error.ts";
import { isPublicSkillFile } from "./public-skill-files.ts";

const skillPaths = Effect.fnUntraced(function* listFiles(
  directory: string
): Effect.fn.Return<
  readonly string[],
  PlatformError,
  FileSystem.FileSystem | Path.Path
> {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const entries = yield* fs.readDirectoryEntries(directory);
  const files: string[] = [];

  for (const entry of entries) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    if (entry.type === "File") {
      files.push(entry.name);
    } else if (entry.type === "Directory") {
      const children = yield* skillPaths(path.join(directory, entry.name));
      files.push(...children.map((child) => `${entry.name}/${child}`));
    }
  }

  return files;
});

export const portableSkills = Effect.fnUntraced(function* buildSkills(
  root: string,
  names: readonly string[]
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;

  return yield* forEachEffect(names, (name) =>
    Effect.gen(function* bundleSkill() {
      const directory = path.join(root, "skills", name);

      const paths = (yield* skillPaths(directory)).filter((file) =>
        isPublicSkillFile(`skills/${name}/${file}`)
      );

      if (!paths.includes("SKILL.md")) {
        return yield* buildError(
          "bundle skill",
          name,
          "Expected a regular SKILL.md file"
        );
      }

      const main = {
        path: "SKILL.md",
        text: yield* fs.readFileString(path.join(directory, "SKILL.md")),
      } as const;

      const companions = yield* Effect.forEach(
        paths.filter((file) => file !== "SKILL.md").toSorted(),
        (relative) =>
          fs
            .readFileString(path.join(directory, relative))
            .pipe(Effect.map((text) => ({ path: relative, text })))
      );

      const files = [main, ...companions] as const;

      const version = createHash("sha256")
        .update(JSON.stringify(files))
        .digest("hex");

      return {
        files,
        name,
        version,
      } satisfies (typeof SkillBundle.Type)[number];
    }).pipe(Effect.mapError((cause) => buildError("bundle skill", name, cause)))
  );
});
