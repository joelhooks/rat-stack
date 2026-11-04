import {
  Workshop,
  Exercise,
  publishWorkshop,
} from "@rat-stack/core/tokenmaxx-workshop";
import {
  WorkshopDirectory,
  listExercises,
  readExercise,
  workshopLinks,
  workshopPrep,
  workshopSchedule,
} from "@rat-stack/core/workshop-directory";
import { Effect, FileSystem, Path, Schema, SchemaIssue } from "effect";

import { buildError, violation } from "./content-error.ts";
import { frontmatterData, scanLeadingFrontmatterFence } from "./svx-ast.ts";

export const workshopDataPath = ".brain/data/tokenmaxx/workshop.json";

export const exerciseDirectory = ".brain/resources/tokenmaxx/exercises";

const decode = <A>(
  schema: Schema.Codec<A, unknown>,
  value: Schema.Json,
  file: string
) =>
  Schema.decodeUnknownEffect(schema)(value, { errors: "all" }).pipe(
    Effect.mapError((cause) =>
      buildError(
        "workshop validation",
        file,
        violation(
          "Workshop data is invalid.",
          SchemaIssue.makeFormatterStandardSchemaV1()(cause.issue)
            .issues.map(
              (issue) =>
                `${issue.path?.map(String).join(".") ?? "(file)"}: ${issue.message}`
            )
            .join("; "),
          `correct the named fields in \`${file}\`, then run \`pnpm --filter @rat-stack/site generate\`.`
        )
      )
    )
  );

export const decodeExerciseSource = Effect.fn("decodeExerciseSource")(
  function* decodeExerciseSource(source: string, file: string) {
    const parsed = yield* Effect.try({
      catch: (cause) => buildError("exercise frontmatter", file, cause),
      try: () => ({
        ...frontmatterData(source, file),
        body: scanLeadingFrontmatterFence(source, file).body,
      }),
    });

    return yield* decode(Exercise, parsed, file);
  }
);

export const loadWorkshop = Effect.fn("loadWorkshop")(function* loadWorkshop(
  root: string
) {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const source = yield* fs.readFileString(path.join(root, workshopDataPath));

  const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(
    source
  ).pipe(
    Effect.mapError((cause) =>
      buildError("workshop JSON", workshopDataPath, cause)
    )
  );

  const workshop = yield* decode(Workshop, json, workshopDataPath);
  const directory = path.join(root, exerciseDirectory);

  const files = (yield* fs.exists(directory))
    ? yield* fs.readDirectory(directory)
    : [];

  const exercises = yield* Effect.forEach(
    files.filter((file) => file.endsWith(".svx")).toSorted(),
    (file) =>
      fs
        .readFileString(path.join(directory, file))
        .pipe(
          Effect.flatMap((text) =>
            decodeExerciseSource(text, `${exerciseDirectory}/${file}`)
          )
        )
  );

  return publishWorkshop(workshop, exercises);
});

const comingSoon = "Coming soon.\n";

interface WorkshopPage {
  readonly routePath: `/${string}`;
  readonly source: string;
  readonly title: string;
}

const exerciseRoute = (id: string): `/tokenmaxx/exercises/${string}` =>
  `/tokenmaxx/exercises/${id}`;

export const workshopPages = Effect.fn("workshopPages")(
  function* workshopPages() {
    const schedule = yield* workshopSchedule.handler({});
    const prep = yield* workshopPrep.handler({});
    const links = yield* workshopLinks.handler({});
    const list = yield* listExercises.handler({});

    const exercises = yield* Effect.forEach(
      (exercise: (typeof list.exercises)[number]) =>
        readExercise.handler({ id: exercise.id })
    )(list.exercises);

    return [
      {
        routePath: "/tokenmaxx/schedule",
        source: `# Workshop schedule\n\n${schedule.runs.map((run) => `## ${run.label}\n\n${run.localNote}\n\n${run.blocks.map((block) => `- ${block.start} to ${block.end}: ${block.name}`).join("\n")}`).join("\n\n")}\n`,
        title: "Workshop schedule",
      },
      {
        routePath: "/tokenmaxx/prep",
        source: `# Workshop prep\n\n${prep.status === "not-yet-published" ? comingSoon : prep.items.map((item, index) => `${index + 1}. ${item.item}${item.optional === true ? " (optional)" : ""}${item.proof === null ? "" : `\n   Proof: ${item.proof}`}`).join("\n")}\n`,
        title: "Workshop prep",
      },
      {
        routePath: "/tokenmaxx/links",
        source: `# Workshop links\n\n${links.status === "not-yet-published" ? comingSoon : links.links.map((link) => `- [${link.repo}](${link.url}): ${link.why}`).join("\n")}\n`,
        title: "Workshop links",
      },
      {
        routePath: "/tokenmaxx/exercises",
        source: `# Workshop exercises\n\n${list.exercises.length === 0 ? comingSoon : list.exercises.map((exercise) => `- [${exercise.title}](${exerciseRoute(exercise.id)})`).join("\n")}\n`,
        title: "Workshop exercises",
      },
      ...exercises.map((exercise) => ({
        routePath: exerciseRoute(exercise.id),
        source: exercise.body,
        title: exercise.title,
      })),
    ] satisfies readonly WorkshopPage[];
  }
);

export const buildWorkshop = Effect.fn("buildWorkshop")(function* buildWorkshop(
  root: string
) {
  const data = yield* loadWorkshop(root);

  const pages = yield* workshopPages().pipe(
    Effect.provide(WorkshopDirectory.layer(data))
  );

  return { data, pages };
});
