import { Effect, Option, Result, Schema, SchemaIssue } from "effect";
import { DomUtils, parseDocument } from "htmlparser2";

import {
  formatDuration,
  rankTube,
  tubeBases,
  TubeData,
  tubeThemes,
  TubeVideo,
  watchUrl,
  videoPagePath,
  relatedVideos,
  summaryLinks,
} from "../../web/src/client/tube/data.ts";
import type { TubeDataValue } from "../../web/src/client/tube/data.ts";
import {
  checkedLabel,
  themeCopy,
  tierLabel,
  tubeCopy,
  tubeDataPath,
  tubeRoutePath,
} from "../../web/src/features/tube/copy.ts";
import { buildError, violation } from "./content-error.ts";
import { TubeDataInvalid } from "./tube-data-invalid.ts";

const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

const schemaFile = "apps/web/src/client/tube/data.ts";

export const TubeFile = Schema.Struct({ videos: Schema.Array(Schema.Json) });

export type TubeFileValue = typeof TubeFile.Type;

const EntryId = Schema.Struct({ id: Schema.String });

const EntrySlug = Schema.Struct({ slug: Schema.String });

const duplicateSlugProblems = (entries: readonly Schema.Json[]) =>
  entries.flatMap((entry, index) =>
    Option.match(Schema.decodeUnknownOption(EntrySlug)(entry), {
      onNone: () => [],
      onSome: ({ slug }) => {
        const first = entries.findIndex((candidate) =>
          Option.exists(
            Schema.decodeUnknownOption(EntrySlug)(candidate),
            (other) => other.slug === slug
          )
        );

        return first === index
          ? []
          : [
              `${tubeDataPath} videos[${index}] repeats slug ${slug} from videos[${first}]. Each published video needs its own stable URL. Fix: assign a unique numeric suffix to \`slug\` in \`${tubeDataPath}\`.`,
            ];
      },
    })
  );

const entryId = (entry: Schema.Json) =>
  Option.map(Schema.decodeUnknownOption(EntryId)(entry), ({ id }) => id);

const httpsProblem = (where: string, field: string, detail: string) =>
  `${where}.${field} is not an https URL (${detail}). The page links and embeds only over https. Fix: use \`https://www.youtube.com/watch?v=<id>\` for \`url\` and the channel's https address for \`channelUrl\`.`;

const takeProblem = (where: string, _field: string, detail: string) =>
  `${where} has no valid take (${detail}). Every entry says what the viewer learns from the video. Fix: write one to three sentences in \`take\`, ending with a full stop.`;

const basisProblem = (where: string, _field: string, detail: string) =>
  `${where}.basis is not a take basis (${detail}). The basis records what the take was checked against, and the page shows it. Fix: set \`basis\` to ${tubeBases.map((basis) => `\`${basis}\``).join(", ")}, naming the source you checked the take against.`;

const themeProblem = (where: string, _field: string, detail: string) =>
  `${where}.theme is not a tube theme (${detail}). The page groups videos under the themes in \`tubeThemes\`. Fix: use one of ${tubeThemes.map((theme) => `\`${theme}\``).join(", ")}, or add the theme to \`tubeThemes\` in \`${schemaFile}\`.`;

const fieldProblems = new Map([
  ["basis", basisProblem],
  ["channelUrl", httpsProblem],
  ["take", takeProblem],
  ["theme", themeProblem],
  ["url", httpsProblem],
]);

const fieldProblem = (where: string, field: string, detail: string) =>
  (
    fieldProblems.get(field) ??
    ((at, name, why) =>
      `${at}.${name} is invalid (${why}). The tube schema rejects this value. Fix: match \`TubeVideo\` in \`${schemaFile}\`.`)
  )(where, field, detail);

const entryProblems = (
  entry: Schema.Json,
  index: number
): readonly string[] => {
  const where = `${tubeDataPath} videos[${index}]`;

  return Result.match(
    Schema.decodeUnknownResult(TubeVideo)(entry, { errors: "all" }),
    {
      onFailure: (failure) =>
        formatIssues(failure.issue).issues.map((issue) =>
          fieldProblem(
            where,
            (issue.path ?? []).map(String).join(".") || "(entry)",
            issue.message
          )
        ),
      onSuccess: (video) => [
        ...(video.url === watchUrl(video.id)
          ? []
          : [
              `${where}.url does not point at video ${video.id}. The link and the player must show the same video. Fix: set \`url\` to \`${watchUrl(video.id)}\`.`,
            ]),
        ...(video.page?.sections.flatMap((section, sectionIndex) =>
          section.at < video.durationSeconds &&
          (sectionIndex === 0 ||
            section.at > (video.page?.sections[sectionIndex - 1]?.at ?? -1))
            ? []
            : [
                `${where}.page.sections[${sectionIndex}].at is outside the ordered video timeline. Section links must seek to distinct points within this video. Fix: use increasing seconds below \`durationSeconds\` in \`${tubeDataPath}\`.`,
              ]
        ) ?? []),
      ],
    }
  );
};

const duplicateProblems = (
  entries: readonly Schema.Json[]
): readonly string[] =>
  entries.flatMap((entry, index) =>
    Option.match(entryId(entry), {
      onNone: () => [],
      onSome: (id) => {
        const first = entries.findIndex((candidate) =>
          Option.contains(entryId(candidate), id)
        );

        return first === index
          ? []
          : [
              `${tubeDataPath} videos[${index}] repeats id ${id} from videos[${first}]. Each video appears once, so it has one rank. Fix: delete one of the two entries in \`${tubeDataPath}\`.`,
            ];
      },
    })
  );

export const tubeConceptProblems = (
  data: TubeDataValue,
  routes: ReadonlySet<string>
): readonly string[] =>
  data.videos.flatMap((video) =>
    (video.page?.concepts ?? []).flatMap((concept) =>
      routes.has(concept.route)
        ? []
        : [
            `${tubeDataPath} video ${video.id} links to unknown concept ${concept.route}. Concepts must resolve to a generated wiki page or glossary anchor. Fix: correct \`page.concepts\` for \`${video.id}\` in \`${tubeDataPath}\`.`,
          ]
    )
  );

export const validateTubeConcepts = (
  data: TubeDataValue,
  routes: ReadonlySet<string>,
  documents: readonly { routePath: string; bodyHtml: string }[]
) => {
  const anchors = documents.flatMap(({ routePath, bodyHtml }) => {
    const document = parseDocument(bodyHtml);

    return DomUtils.findAll(
      (element) => element.attribs.id !== undefined,
      document.children
    ).map((element) => `${routePath}#${element.attribs.id}`);
  });

  const problems = tubeConceptProblems(
    data,
    new Set([...routes, "/learn", ...anchors])
  );

  return problems.length === 0
    ? Effect.void
    : Effect.fail(
        tubeBuildError(
          new TubeDataInvalid({ message: problems.join("\n"), problems })
        )
      );
};

export const tubeGaps = (data: TubeDataValue) => ({
  gaps: [...new Set(data.videos.flatMap((video) => video.page?.gaps ?? []))]
    .toSorted()
    .map((term) => ({
      term,
      videos: data.videos
        .filter((video) => video.page?.gaps.includes(term) === true)
        .map((video) => videoPagePath(video)),
    })),
});

export const tubeVideoMarkdown = (
  video: TubeDataValue["videos"][number],
  videos: TubeDataValue["videos"]
) =>
  [
    `# ${video.title}`,
    "",
    `[${linkText(video.channel)}](${video.channelUrl}) · Published ${video.published} · ${formatDuration(video.durationSeconds)} · ${tierLabel(video.tier)} · ${themeCopy[video.theme].name}`,
    "",
    `[Watch on YouTube](${video.url}) · [All ${tubeCopy.heading} videos](/tube)`,
    "",
    "## Summary",
    "",
    ...(video.page?.summary.flatMap((paragraph) => [
      summaryLinks(paragraph, video)
        .map((part) =>
          part.route === undefined
            ? part.text
            : `[${linkText(part.text)}](${part.route})`
        )
        .join(""),
      "",
    ]) ?? []),
    "## Section notes",
    "",
    ...(video.page?.sections.map(
      ({ at, note }) =>
        `- [${formatDuration(at)}](${video.url}&t=${at}s): ${note}`
    ) ?? []),
    "",
    "## Key concepts",
    "",
    ...((video.page?.concepts.length ?? 0) === 0
      ? ["No matching wiki page yet.", ""]
      : []),
    ...(video.page?.concepts.map(
      ({ term, route }) => `- [${linkText(term)}](${route})`
    ) ?? []),
    "",
    "## Our take",
    "",
    video.take,
    "",
    "## Related videos",
    "",
    ...relatedVideos(video, videos).map(
      (related) => `- [${linkText(related.title)}](${videoPagePath(related)})`
    ),
    "",
    `Summary based on the transcript. Written ${video.page?.written ?? ""}.`,
  ].join("\n");

export const tubeDataProblems = (file: TubeFileValue): readonly string[] => [
  ...file.videos.flatMap(entryProblems),
  ...duplicateProblems(file.videos),
  ...duplicateSlugProblems(file.videos),
];

export const unreadableTubeFile = `${tubeDataPath} is not a JSON object with a videos array. The content build reads every entry from \`videos\`. Fix: shape the file as \`{ "videos": [...] }\` and repair any syntax error that \`JSON.parse\` reports.`;

export const decodeTubeData = Effect.fn("decodeTubeData")(
  function* decodeTubeData(text: string) {
    const file = yield* Schema.decodeEffect(Schema.fromJsonString(TubeFile))(
      text
    ).pipe(
      Effect.mapError(
        (cause) =>
          new TubeDataInvalid({
            cause,
            message: unreadableTubeFile,
            problems: [unreadableTubeFile],
          })
      )
    );

    const problems = tubeDataProblems(file);

    if (problems.length > 0) {
      return yield* new TubeDataInvalid({
        message: problems.join("\n"),
        problems,
      });
    }

    const data = yield* Schema.decodeUnknownEffect(TubeData)(file).pipe(
      Effect.orDie
    );

    return { videos: rankTube(data.videos) } satisfies TubeDataValue;
  }
);

export const tubeBuildError = (error: TubeDataInvalid) =>
  buildError(
    "tube",
    tubeDataPath,
    violation(
      `${tubeDataPath} has ${error.problems.length} ${error.problems.length === 1 ? "problem" : "problems"}.`,
      `The content build checks every entry before it emits ${tubeRoutePath}:\n${error.problems.map((problem) => `- ${problem}`).join("\n")}\n`,
      "correct each problem listed, then run `pnpm --filter @rat-stack/site generate`.",
      error
    )
  );

const linkText = (value: string) => value.replaceAll(/[[\]]/gu, "");

export const tubeMarkdown = (data: TubeDataValue) =>
  [
    `# ${tubeCopy.heading}`,
    "",
    tubeCopy.intro,
    "",
    tubeCopy.rankRule,
    "",
    tubeCopy.disclosure,
    "",
    ...tubeThemes.flatMap((theme) => {
      const videos = data.videos.filter((video) => video.theme === theme);

      return videos.length === 0
        ? []
        : [
            `## ${themeCopy[theme].name}`,
            "",
            themeCopy[theme].blurb,
            "",
            ...videos.map(
              (video) =>
                `- **${tierLabel(video.tier)}**: [${linkText(video.title)}](${video.page === undefined ? video.url : videoPagePath(video)}) by [${linkText(video.channel)}](${video.channelUrl}), ${formatDuration(video.durationSeconds)}, published ${video.published}, ${checkedLabel(video)}. ${video.take}`
            ),
            "",
          ];
    }),
  ].join("\n");
