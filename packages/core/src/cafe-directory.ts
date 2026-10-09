import { implement } from "@rat-stack/capability/implement";
import {
  Array as Arr,
  Context,
  Effect,
  Layer,
  Option,
  Result,
  Schema,
  SchemaIssue,
} from "effect";

import { CafeDataError } from "./cafe-data-error.js";
import { CafeDataInvalid } from "./cafe-data-invalid.js";
import {
  CafeNewsItem,
  CafeProject,
  cafeRankedAt,
  selectCafeNews,
  selectCafeProjects,
} from "./cafe.js";
import type { CafeDataValue } from "./cafe.js";
import { listCafeNewsContract, listCafeProjectsContract } from "./contracts.js";
import type { AssetReadError } from "./contracts.js";

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

const duplicateUrls = (
  file: string,
  entries: readonly { readonly url: string }[]
) =>
  entries.flatMap((entry, index) =>
    entries.findIndex((candidate) => candidate.url === entry.url) < index
      ? [
          new CafeDataError({
            field: "url",
            file,
            index,
            message: `Duplicate url ${entry.url}; keep one entry per url`,
          }),
        ]
      : []
  );

export const decodeCafeEntries = <A extends { readonly url: string }>(
  schema: Schema.Codec<A, unknown>,
  file: string,
  values: readonly Schema.Json[]
): Effect.Effect<readonly A[], readonly CafeDataError[]> =>
  Effect.forEach((value: Schema.Json, index: number) =>
    Schema.decodeEffect(schema)(value, { errors: "all" }).pipe(
      Effect.mapError((failure) => issueErrors(file, index, failure)),
      Effect.result
    )
  )(values).pipe(
    Effect.flatMap((results) => {
      const [entries, failures] = Arr.separate(results);
      const errors = [...failures.flat(), ...duplicateUrls(file, entries)];

      return Arr.isReadonlyArrayNonEmpty(errors)
        ? Effect.fail(errors)
        : Effect.succeed(entries);
    })
  );

const decodeCafeFile = <A extends { readonly url: string }>(
  schema: Schema.Codec<A, unknown>,
  file: string,
  text: string
) =>
  Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Json)))(
    text
  ).pipe(
    Effect.mapError((failure) => issueErrors(file, null, failure)),
    Effect.flatMap((values) => decodeCafeEntries(schema, file, values))
  );

export const cafeProjectsFile = ".brain/data/cafe/projects.json";

export const cafeNewsFile = ".brain/data/cafe/news.json";

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
    readonly projects: string;
  }) {
    const news = yield* Effect.result(
      decodeCafeFile(CafeNewsItem, cafeNewsFile, files.news)
    );

    const projects = yield* Effect.result(
      decodeCafeFile(CafeProject, cafeProjectsFile, files.projects)
    );

    if (Result.isFailure(news) || Result.isFailure(projects)) {
      return yield* invalid(Arr.flatten(Arr.getFailures([news, projects])));
    }

    return yield* Option.match(cafeRankedAt(news.success, projects.success), {
      onNone: () => Effect.fail(invalid([noEntries])),
      onSome: (rankedAt) =>
        Effect.succeed({
          news: news.success,
          projects: projects.success,
          rankedAt,
        } satisfies CafeDataValue),
    });
  }
);

export class CafeDirectory extends Context.Service<
  CafeDirectory,
  { readonly data: Effect.Effect<CafeDataValue, AssetReadError> }
>()("rat-stack/CafeDirectory") {
  static readonly layer = (data: CafeDataValue) =>
    Layer.succeed(CafeDirectory, { data: Effect.succeed(data) });
}

export const listCafeNews = implement(listCafeNewsContract, (query) =>
  CafeDirectory.use((directory) =>
    directory.data.pipe(Effect.map((data) => selectCafeNews(data, query)))
  )
);

export const listCafeProjects = implement(listCafeProjectsContract, (query) =>
  CafeDirectory.use((directory) =>
    directory.data.pipe(Effect.map((data) => selectCafeProjects(data, query)))
  )
);
