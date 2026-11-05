import {
  Array as Arr,
  Effect,
  Option,
  Result,
  Schema,
  SchemaIssue,
} from "effect";

import { CafeDataError } from "./cafe-data-error.js";
import { CafeDataInvalid } from "./cafe-data-invalid.js";
import { CafeNewsItem, CafePerson, CafeProject, cafeRankedAt } from "./cafe.js";
import type { CafeDataValue, CafePersonValue } from "./cafe.js";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const issueErrors = (
  file: string,
  index: number | null,
  failure: Schema.SchemaError
) =>
  formatIssues(failure.issue).issues.map(
    (issue) =>
      new CafeDataError({
        field: Arr.match(issue.path ?? [], {
          onEmpty: () => "(entry)",
          onNonEmpty: (path) => path.map(String).join("."),
        }),
        file,
        index,
        message: issue.message,
      })
  );

export const describeCafeDataError = (issue: CafeDataError) =>
  `${issue.file}${issue.index === null ? "" : `[${issue.index}]`}.${issue.field}: ${issue.message}`;

const invalid = (errors: readonly CafeDataError[]) =>
  new CafeDataInvalid({
    errors,
    message: `CAFE data has ${errors.length} invalid ${errors.length === 1 ? "field" : "fields"}; fix each entry named below, then rebuild:\n${errors.map(describeCafeDataError).join("\n")}`,
  });

const duplicateKeys = <A>(
  file: string,
  entries: readonly { readonly entry: A; readonly index: number }[],
  field: string,
  key: (entry: A) => string
) =>
  entries.flatMap(({ entry, index }, position) =>
    entries.findIndex((candidate) => key(candidate.entry) === key(entry)) <
    position
      ? [
          new CafeDataError({
            field,
            file,
            index,
            message: `Duplicate ${field} ${key(entry)}; keep one entry per ${field}`,
          }),
        ]
      : []
  );

const byUrl = {
  field: "url",
  key: (entry: { readonly url: string }) => entry.url,
};

const decodeKeyedEntries = <A>(
  schema: Schema.Codec<A, unknown>,
  file: string,
  values: readonly Schema.Json[],
  unique: { readonly field: string; readonly key: (entry: A) => string }
): Effect.Effect<readonly A[], readonly CafeDataError[]> =>
  Effect.forEach((value: Schema.Json, index: number) =>
    Schema.decodeEffect(schema)(value, { errors: "all" }).pipe(
      Effect.map((entry) => ({ entry, index })),
      Effect.mapError((failure) => issueErrors(file, index, failure)),
      Effect.result
    )
  )(values).pipe(
    Effect.flatMap((results) => {
      const [entries, failures] = Arr.separate(results);

      const errors = [
        ...failures.flat(),
        ...duplicateKeys(file, entries, unique.field, unique.key),
      ];

      return Arr.isReadonlyArrayNonEmpty(errors)
        ? Effect.fail(errors)
        : Effect.succeed(entries.map(({ entry }) => entry));
    })
  );

export const decodeCafeEntries = <A extends { readonly url: string }>(
  schema: Schema.Codec<A, unknown>,
  file: string,
  values: readonly Schema.Json[]
): Effect.Effect<readonly A[], readonly CafeDataError[]> =>
  decodeKeyedEntries(schema, file, values, byUrl);

const decodeCafeFile = <A>(
  schema: Schema.Codec<A, unknown>,
  file: string,
  text: string,
  unique: { readonly field: string; readonly key: (entry: A) => string }
) =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Json)))(
    text
  ).pipe(
    Effect.mapError((failure) => issueErrors(file, null, failure)),
    Effect.flatMap((values) => decodeKeyedEntries(schema, file, values, unique))
  );

export const cafeProjectsFile = ".brain/data/cafe/projects.json";

export const cafeNewsFile = ".brain/data/cafe/news.json";

export const cafePeopleFile = ".brain/data/cafe/people.json";

const validateBiographies = (people: readonly CafePersonValue[]) => {
  const errors = people.flatMap((person, index) =>
    person.bio.flatMap((fact, factIndex) =>
      /\b(?:he|his|him|she|her|hers)\b/iu.test(fact.text)
        ? [
            new CafeDataError({
              field: `bio.${factIndex}.text`,
              file: cafePeopleFile,
              index,
              message:
                "Biography assumes gendered pronouns. Public profiles must not infer a person's pronouns. Fix: replace the pronoun with the name or project in `.brain/data/cafe/people.json`.",
            }),
          ]
        : []
    )
  );

  return Arr.isReadonlyArrayNonEmpty(errors)
    ? Effect.fail(errors)
    : Effect.succeed(people);
};

const noEntries = new CafeDataError({
  field: "(file)",
  file: cafeNewsFile,
  index: null,
  message:
    "CAFE data has no entries; add at least one approved news item or project",
});

export const decodeCafeData = Effect.fnUntraced(
  function* decodeCafeData(files: {
    readonly news: string;
    readonly people: string;
    readonly projects: string;
  }) {
    const news = yield* Effect.result(
      decodeCafeFile(CafeNewsItem, cafeNewsFile, files.news, byUrl)
    );

    const projects = yield* Effect.result(
      decodeCafeFile(CafeProject, cafeProjectsFile, files.projects, byUrl)
    );

    const people = yield* Effect.result(
      decodeCafeFile(CafePerson, cafePeopleFile, files.people, {
        field: "id",
        key: (person) => person.id,
      }).pipe(Effect.flatMap(validateBiographies))
    );

    if (
      Result.isFailure(news) ||
      Result.isFailure(projects) ||
      Result.isFailure(people)
    ) {
      return yield* invalid(
        Arr.flatten(Arr.getFailures([news, projects, people]))
      );
    }

    return yield* Option.match(cafeRankedAt(news.success, projects.success), {
      onNone: () => Effect.fail(invalid([noEntries])),
      onSome: (rankedAt) =>
        Effect.succeed({
          news: news.success,
          people: people.success,
          projects: projects.success,
          rankedAt,
        } satisfies CafeDataValue),
    });
  }
);
