import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Console, Effect, FileSystem, Path, Schema } from "effect";
import type { PlatformError } from "effect";
import { Command, Flag } from "effect/cli";

import {
  ContentMigrationIssue,
  migrateContentSource,
  migrationLinkFailures,
} from "./content-migration.ts";
import { migrationRegistry } from "./migration-inputs.ts";
import { publishMigrationCandidates } from "./migration-writer.ts";

class ContentMigrationBlocked extends Schema.TaggedError<ContentMigrationBlocked>()(
  "ContentMigrationBlocked",
  {
    diffs: Schema.Finite,
    failures: Schema.Finite,
  }
) {}

const sourceFiles = Effect.fn("migration.sourceFiles")(function* sourceFiles(
  root: string,
  directory: string
): Effect.fn.Return<
  readonly string[],
  PlatformError.PlatformError,
  FileSystem.FileSystem
> {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory(`${root}/${directory}`);
  const files: string[] = [];

  for (const entry of entries.toSorted()) {
    const file = `${directory}/${entry}`;
    const stat = yield* fs.stat(`${root}/${file}`);

    if (stat.type === "Directory") {
      files.push(...(yield* sourceFiles(root, file)));
    } else if (file.endsWith(".svx")) {
      files.push(file);
    }
  }

  return files;
});

const migrate = Command.make(
  "content:migrate",
  {
    dryRun: Flag.Boolean("dry-run").pipe(Flag.withDefault(false)),
    reportDirectory: Flag.String("report-dir").pipe(
      Flag.withDefault(".rat/content-migration/candidates")
    ),
  },
  Effect.fn(function* migrate({ dryRun, reportDirectory }) {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const root = path.resolve(import.meta.dirname, "../../..");
    const output = path.resolve(root, reportDirectory);

    if (
      output === path.join(root, ".brain") ||
      output.startsWith(`${path.join(root, ".brain")}/`)
    ) {
      return yield* new ContentMigrationIssue({
        construct: "output directory",
        line: 1,
        repair:
          "Write candidates outside .brain; this packet cannot change Brain sources.",
        sourcePath: reportDirectory,
      });
    }

    const files = yield* sourceFiles(root, ".brain");
    const { registry } = yield* migrationRegistry(root);

    const knownRoutes = new Set(
      files.flatMap((file) => {
        const route = file
          .replace(/^\.brain\/areas\//u, "/systems/")
          .replace(/^\.brain\/resources\/lore\//u, "/lore/")
          .replace(/\.svx$/u, "");

        return /^\/(?:lore|systems)\/[^/]+$/u.test(route) ? [route] : [];
      })
    );

    const results = yield* Effect.forEach((file: string) =>
      fs.readFileString(`${root}/${file}`).pipe(
        Effect.flatMap((source) =>
          migrateContentSource(source, file, registry).pipe(
            Effect.map((result) => ({
              ...result,
              failures: [
                ...result.failures,
                ...migrationLinkFailures(source, file, knownRoutes),
              ],
            }))
          )
        ),
        Effect.catchTag("ContentMigrationIssue", (issue) =>
          Effect.succeed({
            candidate: "",
            components: [],
            failures: [issue],
            roundTrip: undefined,
            sourcePath: file,
          })
        )
      )
    )(files);

    const failures = results.flatMap((result) => result.failures);

    const diffs = results.flatMap((result) =>
      result.roundTrip !== undefined &&
      result.roundTrip.before !== result.roundTrip.after
        ? [
            {
              after: result.roundTrip.after,
              before: result.roundTrip.before,
              sourcePath: result.sourcePath,
            },
          ]
        : []
    );

    const report = {
      compiled: results.filter((result) => result.roundTrip !== undefined)
        .length,
      componentPages: results
        .filter((result) => result.components.length > 0)
        .map((result) => ({
          components: result.components,
          sourcePath: result.sourcePath,
        })),
      diffs,
      dryRun,
      failedPages: results.filter((result) => result.failures.length > 0)
        .length,
      failures,
      frontmatter:
        "Pre-split nested YAML and decode with Effect Schema; retain raw YAML separately from the Foldkit MarkdownDocument.",
      representation:
        "Compare the old component renderer with agent Markdown folded from the new Document, not copied from the old output. This is source-body parity; public route enrichment needs a separate cutover proof.",
      roundTripDiffCount: diffs.length,
      total: files.length,
      version: 1,
    };

    yield* Console.log(JSON.stringify(report, null, 2));

    if (failures.length > 0 || diffs.length > 0) {
      return yield* new ContentMigrationBlocked({
        diffs: diffs.length,
        failures: failures.length,
      });
    }

    if (!dryRun) {
      yield* publishMigrationCandidates([
        ...results.flatMap((result) => {
          const filename = `${output}/${result.sourcePath.slice(".brain/".length).replace(/\.svx$/u, ".md")}`;

          return [
            { content: result.candidate, filename },
            {
              content: JSON.stringify(result.roundTrip, null, 2),
              filename: `${filename}.document.json`,
            },
          ];
        }),
        {
          content: JSON.stringify(report, null, 2),
          filename: `${output}/report.json`,
        },
      ]);
    }

    return yield* Effect.void;
  })
);

NodeRuntime.runMain(
  migrate.pipe(
    Command.run({ version: "1.0.0" }),
    Effect.provide(NodeServices.layer)
  )
);
