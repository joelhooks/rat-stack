import { Effect, Option, Result, Schema, SchemaIssue } from "effect";

import {
  formatDuration,
  rankTube,
  TubeData,
  tubeThemes,
  TubeVideo,
  watchUrl,
} from "../../web/src/client/tube/data.ts";
import type { TubeDataValue } from "../../web/src/client/tube/data.ts";
import {
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

const entryId = (entry: Schema.Json) =>
  Option.map(Schema.decodeUnknownOption(EntryId)(entry), ({ id }) => id);

const httpsProblem = (where: string, field: string, detail: string) =>
  `${where}.${field} is not an https URL (${detail}). The page links and embeds only over https. Fix: use \`https://www.youtube.com/watch?v=<id>\` for \`url\` and the channel's https address for \`channelUrl\`.`;

const takeProblem = (where: string, _field: string, detail: string) =>
  `${where} has no valid take (${detail}). Every entry says what the viewer learns from the video. Fix: write one to three sentences in \`take\`, ending with a full stop.`;

const themeProblem = (where: string, _field: string, detail: string) =>
  `${where}.theme is not a tube theme (${detail}). The page groups videos under the themes in \`tubeThemes\`. Fix: use one of ${tubeThemes.map((theme) => `\`${theme}\``).join(", ")}, or add the theme to \`tubeThemes\` in \`${schemaFile}\`.`;

const fieldProblems = new Map([
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
      onSuccess: (video) =>
        video.url === watchUrl(video.id)
          ? []
          : [
              `${where}.url does not point at video ${video.id}. The link and the player must show the same video. Fix: set \`url\` to \`${watchUrl(video.id)}\`.`,
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

export const tubeDataProblems = (file: TubeFileValue): readonly string[] => [
  ...file.videos.flatMap(entryProblems),
  ...duplicateProblems(file.videos),
];

export const unreadableTubeFile = `${tubeDataPath} is not a JSON object with a videos array. The content build reads every entry from \`videos\`. Fix: shape the file as \`{ "videos": [...] }\` and repair any syntax error that \`JSON.parse\` reports.`;

export const decodeTubeData = Effect.fn("decodeTubeData")(
  function* decodeTubeData(text: string) {
    const file = yield* Schema.decodeEffect(Schema.fromJsonString(TubeFile))(
      text
    ).pipe(
      Effect.mapError(
        () =>
          new TubeDataInvalid({
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
                `- **${tierLabel(video.tier)}**: [${linkText(video.title)}](${video.url}) by [${linkText(video.channel)}](${video.channelUrl}), ${formatDuration(video.durationSeconds)}, published ${video.published}, checked ${video.checked}. ${video.take}`
            ),
            "",
          ];
    }),
  ].join("\n");
