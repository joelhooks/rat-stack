import { Schema } from "effect";

const Id = Schema.String.check(
  Schema.isPattern(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/u)
);

const Utc = Schema.String;

export const WorkshopBlock = Schema.Struct({
  end: Utc,
  id: Id,
  kind: Schema.Literals(["block", "break"]),
  name: Schema.String,
  start: Utc,
});

export const WorkshopRun = Schema.Struct({
  blocks: Schema.Array(WorkshopBlock),
  date: Schema.String,
  end: Utc,
  label: Schema.String,
  localNote: Schema.String,
  start: Utc,
});

export const WorkshopPrepItem = Schema.Struct({
  id: Id,
  item: Schema.String,
  needs: Schema.optional(Schema.Literal("starterPublic")),
  optional: Schema.optional(Schema.Boolean),
  proof: Schema.NullOr(Schema.String),
});

export const WorkshopLink = Schema.Struct({
  needs: Schema.optional(Schema.Literal("starterPublic")),
  public: Schema.Boolean,
  repo: Schema.String,
  url: Schema.String,
  why: Schema.String,
});

export const PublishedExercise = Schema.Struct({
  body: Schema.String,
  id: Id,
  section: Id,
  status: Schema.Literal("published"),
  title: Schema.String,
});

export const ExerciseSummary = Schema.Struct({
  id: Id,
  section: Id,
  title: Schema.String,
});

export const WorkshopSchedule = Schema.Struct({
  runs: Schema.Array(WorkshopRun),
});

export const WorkshopPrep = Schema.Struct({
  items: Schema.Array(WorkshopPrepItem),
  status: Schema.Literals(["published", "not-yet-published"]),
});

export const WorkshopLinks = Schema.Struct({
  links: Schema.Array(WorkshopLink),
  status: Schema.Literals(["published", "not-yet-published"]),
});

export const ExerciseList = Schema.Struct({
  exercises: Schema.Array(ExerciseSummary),
});

export const CurrentExercise = Schema.Union([
  Schema.Struct({
    block: WorkshopBlock,
    exercises: Schema.Array(ExerciseSummary),
    status: Schema.Literal("running"),
  }),
  Schema.Struct({
    nextStart: Schema.NullOr(Utc),
    status: Schema.Literal("not-running"),
  }),
]);
