import { Effect, FileSystem, Path } from "effect";

import { buildError, violation } from "./content-error.ts";
import { scanLeadingFrontmatterFence } from "./svx-ast.ts";
import {
  decodeExerciseSource,
  exerciseDirectory,
} from "./tokenmaxx-workshop.ts";

export const syncExercises = Effect.fn("syncExercises")(function* syncExercises(
  starter: string,
  root: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const input = path.join(starter, "exercises");
  const output = path.join(root, exerciseDirectory);

  const sections = (yield* fs.readDirectory(input))
    .filter((name) => /^\d{2}-[a-z0-9-]+$/u.test(name))
    .toSorted();

  yield* fs.makeDirectory(output, { recursive: true });
  const written: string[] = [];

  for (const section of sections) {
    const sectionPath = path.join(input, section);

    const entries = (yield* fs.readDirectory(sectionPath))
      .filter((name) => /^\d{2}\.\d+-[a-z0-9-]+$/u.test(name))
      .toSorted();

    for (const entry of entries) {
      const sourcePath = path.join(sectionPath, entry, "explainer/readme.md");

      if (!(yield* fs.exists(sourcePath))) {
        continue;
      }

      const source = yield* fs.readFileString(sourcePath);
      const target = path.join(output, `${entry}.svx`);

      const existing = (yield* fs.exists(target))
        ? yield* fs.readFileString(target)
        : undefined;

      const heading =
        /^#\s+(?<title>.+)$/mu.exec(source)?.groups?.title ?? entry;

      const metadata = {
        id: entry,
        section: section.replace(/^\d{2}-/u, ""),
        status: "draft",
        title: heading,
      };

      const prefix =
        existing === undefined
          ? `---\nid: ${JSON.stringify(metadata.id)}\nsection: ${JSON.stringify(metadata.section)}\ntitle: ${JSON.stringify(metadata.title)}\nstatus: draft\n---\n`
          : yield* Effect.try({
              catch: (cause) => buildError("exercise sync", target, cause),
              try: () => {
                const fence = scanLeadingFrontmatterFence(existing, target);

                return existing.slice(0, fence.offset);
              },
            }).pipe(Effect.tap(() => decodeExerciseSource(existing, target)));

      yield* fs.writeFileString(target, `${prefix}\n${source}`);
      written.push(entry);
    }
  }

  if (written.length === 0) {
    return yield* Effect.fail(
      buildError(
        "exercise sync",
        "exercises",
        violation(
          "No exercise explainers were found.",
          "An empty import cannot update the workshop exercises.",
          "run `pnpm tokenmaxx:sync <starter path>` with `exercises/NN-section/NN.N-name/explainer/readme.md` files."
        )
      )
    );
  }

  return written;
});
