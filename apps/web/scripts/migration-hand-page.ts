import { parseMarkdown } from "@foldkit/markdown/vite";
import { Effect, FileSystem } from "effect";

import {
  parseLorePage,
  renderBibliography,
  loreLinkTargets,
} from "../../site/scripts/content-lib.ts";
import {
  migrateContentSource,
  mapMigrationSource,
} from "../../site/scripts/content-migration.ts";
import { documentMarkdown } from "../../site/scripts/migration-document.ts";
import { migrationRegistry } from "../../site/scripts/migration-inputs.ts";
import { migrationIslands } from "../../site/scripts/migration-islands.ts";
import { readerAssetInputs } from "../../site/scripts/reader-site-inputs.ts";
import {
  scanLeadingFrontmatterFence,
  parseContentMarkdown,
  stringifyContentMarkdown,
} from "../../site/scripts/svx-ast.ts";

export const migrationHandPage = Effect.gen(function* migrationHandPage() {
  const fs = yield* FileSystem.FileSystem;

  const root = new URL("../../../", import.meta.url).pathname.replace(
    /\/$/u,
    ""
  );

  const sourcePath = ".brain/resources/lore/services-capture-dependencies.svx";

  const source = yield* fs.readFileString(
    new URL(
      "../test/fixtures/content-migration/services-capture-dependencies.md",
      import.meta.url
    ).pathname
  );

  const { registry, snippets } = yield* migrationRegistry(root);
  const migrated = yield* migrateContentSource(source, sourcePath, registry);

  if (migrated.roundTrip === undefined || migrated.failures.length > 0) {
    return yield* Effect.die(
      new Error("The hand page must compile without failures")
    );
  }

  const metadata = yield* Effect.try(() => parseLorePage(sourcePath, source));
  const { directory, manifest } = yield* readerAssetInputs;
  const knownRoutes = new Set(manifest.pages.map((page) => page.route));
  yield* Effect.try(() => loreLinkTargets(sourcePath, source, knownRoutes));

  const baseline = yield* fs.readFileString(
    `${directory}/lore/services-capture-dependencies.md`
  );

  const bibliography = renderBibliography(metadata.bibliography);

  const oldCore = stringifyContentMarkdown(
    parseContentMarkdown(
      `${scanLeadingFrontmatterFence(migrated.roundTrip.before, sourcePath).body.trimStart()}${bibliography.markdown}`
    )
  ).trimEnd();

  const start = baseline.indexOf(oldCore);

  if (start === -1 || baseline.includes(oldCore, start + oldCore.length)) {
    return yield* Effect.die(
      new Error(
        "The independently rendered source body must occur exactly once in the old page"
      )
    );
  }

  const sourceBody = scanLeadingFrontmatterFence(
    source,
    sourcePath
  ).body.trimStart();

  const pageSource = `${baseline.slice(0, start)}${sourceBody.trimEnd()}${bibliography.markdown.trimEnd()}${baseline.slice(start + oldCore.length)}`;
  const mapped = mapMigrationSource(pageSource, sourcePath);

  if (mapped.failures.length > 0) {
    return yield* Effect.die(
      new Error(
        "The composed hand Document must contain only supported vocabulary"
      )
    );
  }

  const document = yield* Effect.try(() =>
    parseMarkdown(mapped.candidate, { islands: migrationIslands })
  );

  const markdown = documentMarkdown(
    document,
    registry,
    { sourcePath, sources: metadata.bibliography },
    mapped.lists
  );

  yield* Effect.try(() => loreLinkTargets(sourcePath, markdown, knownRoutes));

  return { baseline, document, markdown, metadata, snippets };
});
