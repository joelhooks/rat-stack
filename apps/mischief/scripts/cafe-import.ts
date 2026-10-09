import { NodeRuntime, NodeServices } from "@effect/platform-node";
import {
  CafeDataError,
  CafeDataInvalid,
  cafeNewsFile,
  cafeProjectsFile,
  decodeCafeData,
  decodeCafeEntries,
  describeCafeDataError,
} from "@rat-stack/core";
import { CafeNewsItem, CafeProject } from "@rat-stack/core/contracts";
import {
  Array,
  Console,
  Effect,
  FileSystem,
  Option,
  Order,
  Schema,
} from "effect";

const Evidence = Schema.NullOr(Schema.String);

const CrawlerReply = Schema.Struct({
  likes: Schema.Finite,
  text: Schema.String,
  url: Schema.String,
  x: Schema.String,
});

const CrawlerLine = Schema.Struct({
  approved: Schema.optionalKey(Schema.Boolean),
  author: Schema.Struct({
    github: Schema.NullOr(Schema.String),
    x: Schema.NullOr(Schema.String),
  }),
  confidence: Schema.Literals(["high", "medium", "low"]),
  date: Schema.NullOr(Schema.String),
  description: Schema.optionalKey(Schema.NullOr(Schema.String)),
  engagement: Schema.optionalKey(Schema.Record(Schema.String, Schema.Json)),
  kind: Schema.Literals(["project", "news", "media", "thread", "person"]),
  newsKind: Schema.optionalKey(Schema.String),
  repo: Schema.NullOr(Schema.String),
  seen: Schema.optionalKey(Schema.Finite),
  source: Schema.String,
  stack: Schema.Struct({
    alchemy: Evidence,
    cloudflare: Evidence,
    effect: Evidence,
    foldkit: Evidence,
  }),
  stars: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  summary: Schema.NullOr(Schema.String),
  title: Schema.String,
  topReplies: Schema.optionalKey(Schema.Array(CrawlerReply)),
  url: Schema.String,
});

type CrawlerLineValue = typeof CrawlerLine.Type;

const shownReplies = 3;

const oneLine = (text: string) => text.replaceAll(/\s+/gu, " ").trim();

const sourceUrl = (line: CrawlerLineValue) =>
  Option.getOrElse(
    Array.last(line.source.match(/https:\/\/[^\s()]+/gu) ?? []),
    () => line.url
  );

const authorValue = (line: CrawlerLineValue) => ({
  github: line.author.github,
  x: line.author.x,
});

const newsKindOf = (line: CrawlerLineValue): string | null => {
  if (line.newsKind !== undefined) {
    return line.newsKind;
  }

  const { hostname, pathname } = new URL(line.url);

  if (line.kind === "thread") {
    return "thread";
  }

  if (line.kind === "media") {
    return hostname.endsWith("youtube.com") ? "video" : null;
  }

  if (hostname === "github.com") {
    return pathname.includes("/releases/") ? "release" : "launch";
  }

  return "post";
};

const projectValue = (line: CrawlerLineValue): Schema.Json => ({
  author: authorValue(line),
  date: line.date,
  repo: line.repo,
  source: sourceUrl(line),
  stack: line.stack,
  stars: line.stars ?? null,
  summary: line.description ?? line.summary,
  title: oneLine(line.title),
  url: line.url,
});

const topReplies = (line: CrawlerLineValue) =>
  Array.take(
    Array.sort(
      (line.topReplies ?? []).filter((reply) => reply.url !== line.url),
      Order.flip(
        Order.mapInput(
          Order.Number,
          (reply: typeof CrawlerReply.Type) => reply.likes
        )
      )
    ),
    shownReplies
  ).map((reply) => ({ ...reply, text: reply.text.trim() }));

const handleList = Schema.decodeUnknownOption(Schema.Array(Schema.String));

const presentFields = (
  fields: readonly (readonly [string, Option.Option<Schema.Json>])[]
) =>
  Object.fromEntries(
    fields.flatMap(([key, value]) =>
      Option.toArray(value).map((present) => [key, present] as const)
    )
  );

const newsValue = (line: CrawlerLineValue): Schema.Json => {
  const engagement = {
    ...line.engagement,
    ...presentFields([
      [
        "participants",
        Option.map(
          handleList(line.engagement?.participants),
          (handles) => handles.length
        ),
      ],
      ["seen", Option.fromUndefinedOr(line.seen)],
    ]),
  };

  return {
    author: authorValue(line),
    date: line.date,
    kind: newsKindOf(line),
    repo: line.repo,
    source: sourceUrl(line),
    summary: line.summary,
    title: oneLine(line.title),
    url: line.url,
    ...presentFields([
      [
        "engagement",
        Option.liftPredicate(
          engagement,
          (fields) => Object.keys(fields).length > 0
        ),
      ],
      [
        "topReplies",
        line.kind === "thread" ? Option.some(topReplies(line)) : Option.none(),
      ],
    ]),
  };
};

const usage =
  "Usage: pnpm cafe:import <crawler.jsonl> [--approved-file] [--write]\nA line imports when it says approved: true, or with --approved-file unless it says approved: false.\nWithout --write, the import reports what it would add and changes nothing.";

const readEntries = (fs: FileSystem.FileSystem, file: string) =>
  fs
    .readFileString(file)
    .pipe(
      Effect.flatMap(
        Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Schema.Json)))
      )
    );

const identityOf = Schema.decodeUnknownOption(
  Schema.Struct({
    repo: Schema.optionalKey(Schema.NullOr(Schema.String)),
    url: Schema.String,
  })
);

const identities = (entry: {
  readonly repo?: string | null;
  readonly url: string;
}) => [
  entry.url.toLowerCase(),
  ...(entry.repo === undefined || entry.repo === null
    ? []
    : [`repo:${entry.repo.toLowerCase()}`]),
];

const atLine =
  (entries: readonly { readonly number: number }[]) => (issue: CafeDataError) =>
    new CafeDataError({
      field: issue.field,
      file: issue.file,
      index:
        issue.index === null ? null : (entries[issue.index]?.number ?? null),
      message: issue.message,
    });

const program = Effect.gen(function* cafeImport() {
  const fs = yield* FileSystem.FileSystem;
  const [input, ...flags] = process.argv.slice(2);

  if (input === undefined) {
    return yield* Console.error(usage);
  }

  const write = flags.includes("--write");
  const approvedFile = flags.includes("--approved-file");

  const lines = (yield* fs.readFileString(input))
    .split("\n")
    .map((text, index) => ({ number: index + 1, text: text.trim() }))
    .filter((line) => line.text.length > 0);

  const parsed = yield* Effect.forEach(
    ({ number, text }: (typeof lines)[number]) =>
      Schema.decodeEffect(Schema.fromJsonString(CrawlerLine))(text).pipe(
        Effect.map((line) => ({ line, number })),
        Effect.mapError(
          (issue) =>
            new CafeDataError({
              field: "(line)",
              file: input,
              index: number,
              message: `unreadable crawler line: ${issue.message}`,
            })
        ),
        Effect.result
      )
  )(lines);

  const [decoded, unreadable] = Array.separate(parsed);

  const existingNews = yield* readEntries(fs, cafeNewsFile);
  const existingProjects = yield* readEntries(fs, cafeProjectsFile);

  const knownUrls = new Set(
    [...existingNews, ...existingProjects].flatMap((entry) =>
      Option.toArray(
        Option.map(identityOf(entry), ({ url }) => url.toLowerCase())
      )
    )
  );

  const knownRepos = new Set(
    existingProjects.flatMap((entry) =>
      Option.toArray(identityOf(entry)).flatMap(identities)
    )
  );

  const isKnown = (line: CrawlerLineValue) =>
    knownUrls.has(line.url.toLowerCase()) ||
    (line.kind === "project" &&
      identities(line).some((identity) => knownRepos.has(identity)));

  const isApproved = (line: CrawlerLineValue) => line.approved ?? approvedFile;

  const candidates = decoded.filter(
    ({ line }) => isApproved(line) && line.kind !== "person"
  );

  const skipped = candidates.filter(({ line }) => isKnown(line));

  const approved = Array.dedupeWith(
    candidates.filter(({ line }) => !isKnown(line)),
    (left, right) =>
      left.line.url.toLowerCase() === right.line.url.toLowerCase() ||
      (left.line.kind === "project" &&
        right.line.kind === "project" &&
        left.line.repo !== null &&
        left.line.repo.toLowerCase() === right.line.repo?.toLowerCase())
  );

  const projectLines = approved.filter(({ line }) => line.kind === "project");
  const newsLines = approved.filter(({ line }) => line.kind !== "project");

  const projectCheck = yield* Effect.result(
    decodeCafeEntries(
      CafeProject,
      input,
      projectLines.map(({ line }) => projectValue(line))
    ).pipe(Effect.mapError((issues) => issues.map(atLine(projectLines))))
  );

  const newsCheck = yield* Effect.result(
    decodeCafeEntries(
      CafeNewsItem,
      input,
      newsLines.map(({ line }) => newsValue(line))
    ).pipe(Effect.mapError((issues) => issues.map(atLine(newsLines))))
  );

  const rejected = [
    ...unreadable,
    ...Array.getFailures([projectCheck, newsCheck]).flat(),
  ];

  yield* Console.log(
    `${decoded.length} lines read; ${approved.length} approved and new; ${projectLines.length} projects, ${newsLines.length} news`
  );

  yield* Effect.forEach(
    skipped,
    ({ line, number }) =>
      Console.log(
        `${input}[${number}] already listed, kept the existing entry: ${line.url}`
      ),
    { discard: true }
  );

  if (rejected.length > 0) {
    return yield* new CafeDataInvalid({
      errors: rejected,
      message: `${rejected.length} problems in the crawler file, named as file[line].field. Fix or unapprove those lines, then rerun:\n${rejected.map(describeCafeDataError).join("\n")}`,
    });
  }

  const news = [
    ...existingNews,
    ...newsLines.map(({ line }) => newsValue(line)),
  ];

  const projects = [
    ...existingProjects,
    ...projectLines.map(({ line }) => projectValue(line)),
  ];

  const newsText = `${JSON.stringify(news, null, 2)}\n`;
  const projectsText = `${JSON.stringify(projects, null, 2)}\n`;

  yield* decodeCafeData({ news: newsText, projects: projectsText });

  if (!write) {
    return yield* Console.log(
      "Dry run: rerun with --write to update the data files."
    );
  }

  yield* fs.writeFileString(cafeNewsFile, newsText);
  yield* fs.writeFileString(cafeProjectsFile, projectsText);

  return yield* Console.log(`Wrote ${cafeNewsFile} and ${cafeProjectsFile}.`);
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
