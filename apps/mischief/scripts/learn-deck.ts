import { deriveDeck } from "@rat-stack/learn/build";
import { Effect, Schema } from "effect";

import { buildError } from "./content-error.ts";
import type { LorePageMetadata } from "./content-lib.ts";
import type { LearnSnippet } from "./learn-snippets.ts";
import { frontmatterData } from "./svx-ast.ts";

interface SkillCardPage {
  readonly description: string;
  readonly name: string;
  readonly rawText: string;
  readonly routePath: string;
  readonly sourcePath: string;
}

export const buildLearningDeck = Effect.fn("buildLearningDeck")(
  function* buildLearningDeck(
    lore: readonly LorePageMetadata[],
    skills: readonly SkillCardPage[],
    priority: readonly string[] = [],
    snippets: readonly LearnSnippet[] = []
  ) {
    const snippetFor = (id: string) => {
      const snippet = snippets.find((entry) => entry.id === id);

      return {
        snippet: snippet?.text,
        snippetDiagnostics: snippet?.diagnostics,
      };
    };

    const result = yield* Effect.try({
      catch: (cause) => buildError("learn deck", "public pages", cause),
      try: () =>
        deriveDeck(
          [
            ...lore.map((page) => {
              const id = `${page.group === "system" ? "system" : "lore"}.${page.slug}`;

              return {
                ...snippetFor(id),
                card: page.card ?? page.description,
                description: page.description,
                diagram: page.diagram,
                id,
                kind:
                  page.group === "system"
                    ? ("system" as const)
                    : ("lore" as const),
                learn: page.learn,
                plain: page.plain,
                prerequisites: page.prerequisites,
                routePath: page.routePath,
                sources: page.sources,
                terms: page.terms,
                title: page.title,
              };
            }),
            ...skills.map((page) => {
              const metadata = Schema.decodeUnknownSync(
                Schema.Struct({
                  card: Schema.optional(Schema.String),
                  diagram: Schema.optional(Schema.String),
                  plain: Schema.optional(Schema.String),
                  prerequisites: Schema.optional(Schema.Array(Schema.String)),
                  sources: Schema.optional(Schema.Array(Schema.String)),
                  terms: Schema.optional(Schema.Array(Schema.String)),
                })
              )(frontmatterData(page.rawText, page.sourcePath));

              return {
                ...snippetFor(`skill.${page.name}`),
                card: metadata.card ?? page.description,
                description: page.description,
                diagram: metadata.diagram,
                id: `skill.${page.name}`,
                kind: "skill" as const,
                plain: metadata.plain,
                prerequisites: metadata.prerequisites ?? [],
                routePath: page.routePath,
                sources: metadata.sources ?? [],
                terms: metadata.terms ?? [],
                title: page.name,
              };
            }),
          ],
          priority,
          snippets.map((snippet) => snippet.id)
        ),
    });

    for (const warning of result.warnings) {
      yield* Effect.logWarning(
        `Learn coverage: ${warning.id}: ${warning.reason}`
      );
    }

    const { coverage } = result;

    if (coverage.missing.length > 0) {
      yield* Effect.logWarning(
        `Learn teaching coverage: snippet ${coverage.snippet}/${coverage.cards}, diagram ${coverage.diagram}/${coverage.cards}, plain ${coverage.plain}/${coverage.cards}. Add .brain/data/learn-cards/<id>.ts and diagram frontmatter to close it.`
      );
    }

    return result.cards;
  }
);
