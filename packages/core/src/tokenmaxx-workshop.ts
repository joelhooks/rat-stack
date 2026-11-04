import { DateTime, Option, Schema } from "effect";

import {
  WorkshopBlock as BlockOutput,
  WorkshopRun as RunOutput,
  WorkshopPrepItem as PrepItemOutput,
  WorkshopLink as LinkOutput,
  PublishedExercise,
  WorkshopPrep,
  WorkshopLinks,
} from "./tokenmaxx-workshop-contracts.js";
import type { CurrentExercise } from "./tokenmaxx-workshop-contracts.js";

export { PublishedExercise } from "./tokenmaxx-workshop-contracts.js";

const Status = Schema.Literals(["draft", "published"]);

const Utc = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u),
  Schema.makeFilter((value) => Option.isSome(DateTime.make(value)))
);

export const WorkshopBlock = Schema.Struct({
  ...BlockOutput.fields,
  end: Utc,
  name: Schema.NonEmptyString,
  start: Utc,
}).check(Schema.makeFilter((block) => block.start < block.end));

export const WorkshopRun = Schema.Struct({
  ...RunOutput.fields,
  blocks: Schema.Array(WorkshopBlock),
  date: Schema.String.check(Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u)),
  end: Utc,
  label: Schema.NonEmptyString,
  start: Utc,
}).check(
  Schema.makeFilter(
    (run) =>
      run.start < run.end &&
      run.start.startsWith(run.date) &&
      run.end.startsWith(run.date) &&
      run.blocks.every(
        (block, index) =>
          block.start >= run.start &&
          block.end <= run.end &&
          (index === 0 ||
            block.start >= (run.blocks[index - 1]?.end ?? run.start))
      ) &&
      new Set(run.blocks.map((block) => block.id)).size === run.blocks.length
  )
);

export const WorkshopPrepItem = Schema.Struct({
  ...PrepItemOutput.fields,
  item: Schema.NonEmptyString,
});

export const WorkshopLink = Schema.Struct({
  ...LinkOutput.fields,
  url: Schema.String.check(Schema.isPattern(/^https:\/\/[^\s/]+(?:\/\S*)?$/u)),
  why: Schema.NonEmptyString,
});

export const Workshop = Schema.Struct({
  links: Schema.Struct({
    links: Schema.Array(WorkshopLink),
    never: Schema.Array(Schema.String),
    note: Schema.String,
    status: Status,
  }),
  prep: Schema.Struct({
    items: Schema.Array(WorkshopPrepItem),
    note: Schema.String,
    status: Status,
  }),
  runs: Schema.Array(WorkshopRun),
  starterPublic: Schema.Boolean,
});

export const Exercise = Schema.Struct({
  ...PublishedExercise.fields,
  status: Status,
  title: Schema.NonEmptyString,
});

export const WorkshopPublicData = Schema.Struct({
  exercises: Schema.Array(PublishedExercise),
  links: WorkshopLinks,
  prep: WorkshopPrep,
  runs: Schema.Array(WorkshopRun),
});

const forbiddenRepo = /(?:^|\/)(?:rat-king-infra|herdr-worktrees)(?:$|[/?#])/u;

const starterRepo =
  /(?:^|\/)(?:tokenmaxx-starter|workshop-starter)(?:$|[/?#])/u;

export const publishWorkshop = (
  workshop: typeof Workshop.Type,
  exercises: readonly (typeof Exercise.Type)[]
): typeof WorkshopPublicData.Type => ({
  exercises: exercises.filter(
    (exercise): exercise is typeof PublishedExercise.Type =>
      exercise.status === "published"
  ),
  links: {
    links:
      workshop.links.status === "published"
        ? workshop.links.links.filter(
            (link) =>
              link.public &&
              (link.needs !== "starterPublic" || workshop.starterPublic) &&
              !forbiddenRepo.test(link.repo) &&
              !forbiddenRepo.test(link.url) &&
              (workshop.starterPublic ||
                (!starterRepo.test(link.repo) &&
                  !starterRepo.test(link.url))) &&
              !workshop.links.never.some((name) =>
                link.repo.split("/").includes(name)
              )
          )
        : [],
    status:
      workshop.links.status === "published" ? "published" : "not-yet-published",
  },
  prep: {
    items:
      workshop.prep.status === "published"
        ? workshop.prep.items.filter(
            (item) => item.needs !== "starterPublic" || workshop.starterPublic
          )
        : [],
    status:
      workshop.prep.status === "published" ? "published" : "not-yet-published",
  },
  runs: workshop.runs,
});

export const exerciseSummary = ({
  id,
  section,
  title,
}: typeof Exercise.Type) => ({ id, section, title });

export const currentWorkshopExercise = (
  data: typeof WorkshopPublicData.Type,
  run: string,
  now: number
): typeof CurrentExercise.Type => {
  const blocks =
    data.runs.find((candidate) => candidate.date === run)?.blocks ?? [];

  const block = blocks.find((candidate) => {
    const start = DateTime.toEpochMillis(DateTime.makeUnsafe(candidate.start));
    const end = DateTime.toEpochMillis(DateTime.makeUnsafe(candidate.end));

    return start <= now && now < end;
  });

  if (block !== undefined) {
    return {
      block,
      exercises:
        block.kind === "break"
          ? []
          : data.exercises
              .filter((exercise) => exercise.section === block.id)
              .map(exerciseSummary),
      status: "running",
    };
  }

  return {
    nextStart:
      blocks.find(
        (candidate) =>
          DateTime.toEpochMillis(DateTime.makeUnsafe(candidate.start)) > now
      )?.start ?? null,
    status: "not-running",
  };
};
