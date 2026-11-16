import {
  GuideTable,
  carriesJoinDetails,
} from "@rat-stack/core/tokenmaxx-help-guide";
import { Effect, FileSystem, Option, Path, Schema, SchemaIssue } from "effect";

import { buildError, violation } from "./content-error.ts";

export const helpGuidePath = ".brain/data/tokenmaxx/help.json";

const Text = Schema.optional(
  Schema.Union([Schema.String, Schema.Array(Schema.String)])
);

const RawTable = Schema.Struct({
  rows: Schema.Array(
    Schema.Struct({ fix: Text, keywords: Text, symptom: Text })
  ),
});

const joinDetailRows = (json: Schema.Json) =>
  Option.match(Schema.decodeUnknownOption(RawTable)(json), {
    onNone: () => [],
    onSome: ({ rows }) =>
      rows.flatMap((row, index) =>
        [row.fix, row.keywords, row.symptom]
          .flat()
          .some((text) => text !== undefined && carriesJoinDetails(text))
          ? [index]
          : []
      ),
  });

export const joinDetailViolation = (rows: readonly number[]) =>
  violation(
    `Help guide rows ${rows.join(", ")} carry workshop join details.`,
    "Agents read guide rows over a public endpoint, and the Zoom link, meeting ID and passcode go out only in the workshop email.",
    `remove the Zoom link, meeting ID or passcode from those rows in \`${helpGuidePath}\`, then run \`pnpm --filter @rat-stack/site generate\`.`
  );

export const decodeHelpGuide = (json: Schema.Json) =>
  Effect.gen(function* decodeGuideTable() {
    const leaking = joinDetailRows(json);

    if (leaking.length > 0) {
      return yield* buildError(
        "help guide validation",
        helpGuidePath,
        joinDetailViolation(leaking)
      );
    }

    return yield* Schema.decodeUnknownEffect(GuideTable)(json, {
      errors: "all",
    }).pipe(
      Effect.mapError((cause) =>
        buildError(
          "help guide validation",
          helpGuidePath,
          violation(
            "The help guide table is invalid.",
            SchemaIssue.makeFormatterStandardSchemaV1()(cause.issue)
              .issues.map(
                (issue) =>
                  `${issue.path?.map(String).join(".") ?? "(file)"}: ${issue.message}`
              )
              .join("; "),
            `correct the named fields in \`${helpGuidePath}\`, then run \`pnpm --filter @rat-stack/site generate\`.`
          )
        )
      )
    );
  });

export const buildHelpGuide = Effect.fn("buildHelpGuide")(
  function* buildHelpGuide(root: string) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const source = yield* fs.readFileString(path.join(root, helpGuidePath));

    const json = yield* Schema.decodeEffect(Schema.fromJsonString(Schema.Json))(
      source
    ).pipe(
      Effect.mapError((cause) =>
        buildError("help guide JSON", helpGuidePath, cause)
      )
    );

    return yield* decodeHelpGuide(json);
  }
);
