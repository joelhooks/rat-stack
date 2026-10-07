import { deriveDeck } from "@rat-stack/learn/build";
import { Effect, Schema } from "effect";

import { buildError } from "./content-error.ts";
import type { LorePageMetadata } from "./content-lib.ts";
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
    priority: readonly string[] = []
  ) {
    const result = yield* Effect.try({
      catch: (cause) => buildError("learn deck", "public pages", cause),
      try: () =>
        deriveDeck(
          [
            ...lore.map((page) => ({
              card: page.card ?? page.description,
              description: page.description,
              id: `${page.group === "system" ? "system" : "lore"}.${page.slug}`,
              kind:
                page.group === "system"
                  ? ("system" as const)
                  : ("lore" as const),
              prerequisites: page.prerequisites,
              routePath: page.routePath,
              sources: page.sources,
              terms: page.terms,
              title: page.title,
            })),
            ...skills.map((page) => {
              const metadata = Schema.decodeUnknownSync(
                Schema.Struct({
                  card: Schema.optional(Schema.String),
                  prerequisites: Schema.optional(Schema.Array(Schema.String)),
                  sources: Schema.optional(Schema.Array(Schema.String)),
                  terms: Schema.optional(Schema.Array(Schema.String)),
                })
              )(frontmatterData(page.rawText, page.sourcePath));

              return {
                card: metadata.card ?? page.description,
                description: page.description,
                id: `skill.${page.name}`,
                kind: "skill" as const,
                prerequisites: metadata.prerequisites ?? [],
                routePath: page.routePath,
                sources: metadata.sources ?? [],
                terms: metadata.terms ?? [],
                title: page.name,
              };
            }),
          ],
          priority
        ),
    });

    for (const warning of result.warnings) {
      yield* Effect.logWarning(
        `Learn coverage: ${warning.id}: ${warning.reason}`
      );
    }

    return result.cards;
  }
);
