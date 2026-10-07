import { CardSchema } from "@rat-stack/core/learn";
import type { Card } from "@rat-stack/core/learn";
import { Exit, Schema } from "effect";

export interface CardSource {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly card?: string;
  readonly terms: readonly string[];
  readonly prerequisites: readonly string[];
  readonly sources: readonly string[];
  readonly routePath: string;
  readonly kind: "lore" | "system" | "skill";
}

export const CardDiagnostic = Schema.Struct({
  id: Schema.String,
  reason: Schema.String,
});

export class InvalidLearnDeck extends Schema.TaggedError<InvalidLearnDeck>()(
  "InvalidLearnDeck",
  {
    errors: Schema.Array(CardDiagnostic),
  }
) {}

export const deriveDeck = (pages: readonly CardSource[]) => {
  const errors: (typeof CardDiagnostic.Type)[] = [];
  const warnings: (typeof CardDiagnostic.Type)[] = [];
  const ids = new Set(pages.map((page) => page.id));
  const routes = new Map(pages.map((page) => [page.routePath, page.id]));
  const cards: Card[] = [];

  for (const page of pages) {
    const summary = page.card ?? page.description;

    if (summary.trim() === "") {
      errors.push({
        id: page.id,
        reason: "Missing summary; set description or card frontmatter.",
      });
    }

    if (page.sources.length === 0 && page.kind !== "skill") {
      errors.push({
        id: page.id,
        reason: "Missing reference; add a public source or page reference.",
      });
    }

    if (page.routePath.trim() === "") {
      errors.push({ id: page.id, reason: "Missing public page route." });
    }

    if (page.terms.length === 0) {
      warnings.push({
        id: page.id,
        reason: "No terms; coverage needs source-grounded metadata.",
      });
    }

    if (page.prerequisites.length === 0) {
      warnings.push({
        id: page.id,
        reason: "No explicit prerequisites; graph links are not prerequisites.",
      });
    }

    const prerequisites = page.prerequisites.map((id) => routes.get(id) ?? id);

    for (const id of prerequisites) {
      if (!ids.has(id) || id === page.id) {
        errors.push({
          id: page.id,
          reason: `Unresolved or self prerequisite: ${id}`,
        });
      }
    }

    const candidate = {
      claim: page.title,
      id: page.id,
      kind: page.kind,
      prerequisites,
      references:
        page.sources.length === 0 && page.kind === "skill"
          ? [`https://ratstack.sh${page.routePath}`]
          : page.sources,
      routePath: page.routePath,
      summary,
      terms: page.terms,
      version: 1,
    };

    const result = Schema.decodeUnknownExit(CardSchema)(candidate);

    if (Exit.isFailure(result)) {
      errors.push({
        id: page.id,
        reason:
          "Invalid card shape; check id, claim, summary, references and route.",
      });
    } else {
      cards.push(result.value);
    }
  }

  for (const id of ids) {
    if (pages.filter((page) => page.id === id).length > 1) {
      errors.push({ id, reason: "Duplicate concept id." });
    }
  }

  if (errors.length > 0) {
    throw new InvalidLearnDeck({ errors });
  }

  return {
    cards: cards.toSorted((a, b) => a.id.localeCompare(b.id)),
    warnings,
  };
};
