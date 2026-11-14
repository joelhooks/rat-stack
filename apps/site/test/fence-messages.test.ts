import { describe, expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";

import {
  fenceMessage,
  placeholderValue,
} from "../../../packages/core/test/fixtures/fence-message.js";
import { parseLorePage, SYSTEMS_DIRECTORY } from "../scripts/content-lib.ts";
import { GitSnapshotError } from "../scripts/git-snapshot.ts";
import { glossaryFirstUseWarningText } from "../scripts/glossary-first-use.ts";
import { PublicAuthBundleLeak } from "../scripts/startup-auth-dependency.ts";
import { StartupBuildDependency } from "../scripts/startup-build-dependency.ts";
import { StartupGraphInvalid } from "../scripts/startup-set.ts";
import { StartupWorkerEntryMissing } from "../scripts/startup-worker-entry-missing.ts";
import { wikiProseWarningText } from "../scripts/wiki-prose.ts";

const word = Arbitrary.schema(placeholderValue);

const count = Arbitrary.schema(
  Schema.Int.check(Schema.isBetween({ maximum: 10_000_000, minimum: 0 }))
);

const frontmatter = (fields: readonly string[]) =>
  `---\n${fields.join("\n")}\n---\n\n# Page\n`;

const validFields = [
  'title: "One idea"',
  'description: "A short sentence."',
  "group: idea",
  "terms:",
  '  - "one idea"',
  "sources: []",
];

const replaceField = (prefix: string, replacement: readonly string[]) =>
  validFields.flatMap((field) =>
    field.startsWith(prefix) ? replacement : [field]
  );

const lorePath = ".brain/resources/lore/one-idea.svx";

const plantedPages = {
  badSlug: [".brain/resources/lore/Bad_slug.svx", frontmatter(validFields)],
  bareUrlSource: [
    lorePath,
    frontmatter(replaceField("sources:", ['sources: ["https://example.com"]'])),
  ],
  emptyTerm: [lorePath, frontmatter(replaceField('  - "one', ['  - ""']))],
  emptyTitle: [lorePath, frontmatter(replaceField("title:", ['title: ""']))],
  httpSource: [
    lorePath,
    frontmatter(replaceField("sources:", ['sources: ["http://example.com"]'])),
  ],
  missingGroup: [lorePath, frontmatter(replaceField("group:", []))],
  noFrontmatter: [lorePath, "# Page\n"],
  noTerms: [
    lorePath,
    frontmatter(
      validFields.filter(
        (field) => field !== "terms:" && !field.includes('"one idea"')
      )
    ),
  ],
  sourceWithoutSpeaker: [
    lorePath,
    frontmatter(replaceField("group:", ["group: source"])),
  ],
  systemMissingSections: [
    `${SYSTEMS_DIRECTORY}/one-idea.svx`,
    frontmatter(replaceField("group:", ["group: system"])),
  ],
  systemOutsideDirectory: [
    lorePath,
    frontmatter(replaceField("group:", ["group: system"])),
  ],
  twoSentenceDescription: [
    lorePath,
    frontmatter(
      replaceField("description:", ['description: "One claim. Two claims."'])
    ),
  ],
} as const;

const plantedPage = Arbitrary.schema(
  Schema.Literals([
    "badSlug",
    "bareUrlSource",
    "emptyTerm",
    "emptyTitle",
    "httpSource",
    "missingGroup",
    "noFrontmatter",
    "noTerms",
    "sourceWithoutSpeaker",
    "systemMissingSections",
    "systemOutsideDirectory",
    "twoSentenceDescription",
  ])
);

const thrownMessage = (run: () => void) => {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : "";
  }

  return "";
};

describe("content-build fence messages", () => {
  it.prop(
    "every planted lore page violation names what, why, and the fix",
    { planted: plantedPage },
    ({ planted }) => {
      const [sourcePath, text] = plantedPages[planted];

      const message = thrownMessage(() => {
        parseLorePage(sourcePath, text);
      });

      expect(message).toContain(`failed for ${sourcePath}`);
      expect(fenceMessage(message)).toBeDefined();
    }
  );

  it.prop(
    "every wiki prose and glossary warning names what, why, and the fix",
    {
      file: word,
      limit: count,
      line: count,
      match: word,
      term: word,
    },
    ({ file, line, limit, match, term }) => {
      const texts = [
        glossaryFirstUseWarningText({
          file,
          line,
          target: `/lore/${term}`,
          term,
        }),
        ...(["em-dash", "hedge", "history"] as const).map((kind) =>
          wikiProseWarningText({ file, kind, line, match })
        ),
        ...(["paragraph", "sentence"] as const).map((kind) =>
          wikiProseWarningText({ count: limit + 1, file, kind, limit, line })
        ),
      ];

      expect(texts.filter((text) => fenceMessage(text) === undefined)).toEqual(
        []
      );
    }
  );
});

describe("startup fence messages", () => {
  it.prop(
    "every startup and Git snapshot failure names what, why, and the fix",
    { module: word, worker: word },
    ({ module, worker }) => {
      const failures = [
        new StartupWorkerEntryMissing({ entry: module, worker }),
        new StartupWorkerEntryMissing({ entry: module, worker: "TurboCache" }),
        new PublicAuthBundleLeak({ modules: [module] }),
        new StartupBuildDependency({ modules: [module] }),
        new StartupGraphInvalid({ detail: module, entry: worker }),
        new GitSnapshotError({ entry: module, reason: worker }),
      ];

      expect(
        failures.filter(
          (failure) => fenceMessage(failure.message) === undefined
        )
      ).toEqual([]);
    }
  );
});
