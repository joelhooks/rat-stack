import {
  CardSchema,
  DIAGRAM_COLUMNS,
  DIAGRAM_ROWS,
  DiagramSchema,
  PlainLineSchema,
  SNIPPET_LINES,
  SnippetSchema,
} from "@rat-stack/core/learn";
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
  readonly plain?: string | undefined;
  readonly snippet?: string | undefined;
  readonly snippetDiagnostics?: readonly string[] | undefined;
  readonly diagram?: string | undefined;
  readonly learn?: boolean | undefined;
}

export interface TeachingCoverage {
  readonly cards: number;
  readonly diagram: number;
  readonly missing: readonly string[];
  readonly plain: number;
  readonly snippet: number;
}

const teachingFields = [
  {
    field: "plain",
    reason:
      "Plain line must be one line of at most 160 characters. The card shows it as a single caption. Fix: shorten `plain:` in the frontmatter to one line of at most 160 characters.",
    schema: PlainLineSchema,
  },
  {
    field: "snippet",
    reason: `Snippet must be non-empty with at most ${SNIPPET_LINES} lines. A card shows the whole snippet without scrolling. Fix: trim \`.brain/data/learn-cards/<id>.ts\` to at most ${SNIPPET_LINES} lines.`,
    schema: SnippetSchema,
  },
  {
    field: "diagram",
    reason: `Diagram must fit ${DIAGRAM_COLUMNS} columns and ${DIAGRAM_ROWS} rows of one-column characters. Wider characters break the box alignment in terminals and cards. Fix: redraw \`diagram:\` within ${DIAGRAM_COLUMNS} by ${DIAGRAM_ROWS}, and replace tabs, emoji, wide CJK, and combining marks.`,
    schema: DiagramSchema,
  },
] as const;

const teachingDiagnostics = (page: CardSource) => [
  ...teachingFields.flatMap(({ field, reason, schema }) => {
    const value = page[field];

    return value === undefined ||
      Exit.isSuccess(Schema.decodeExit(schema)(value))
      ? []
      : [{ id: page.id, reason }];
  }),
  ...(page.snippetDiagnostics ?? []).map((diagnostic) => ({
    id: page.id,
    reason: `Snippet does not compile: ${diagnostic}. Learners copy snippets, so each one must typecheck. Fix: correct \`.brain/data/learn-cards/<id>.ts\` until \`pnpm --filter @rat-stack/site generate\` reports no diagnostic.`,
  })),
];

const teachingOf = (page: CardSource) => {
  const teaching: Partial<Record<TeachingField, string>> = {};

  for (const { field } of teachingFields) {
    const value = page[field];

    if (value !== undefined) {
      teaching[field] = value;
    }
  }

  return teaching;
};

type TeachingField = (typeof teachingFields)[number]["field"];

const teachingCoverage = (pages: readonly CardSource[]): TeachingCoverage => ({
  cards: pages.length,
  diagram: pages.filter((page) => page.diagram !== undefined).length,
  missing: pages.flatMap((page) =>
    page.snippet === undefined || page.diagram === undefined ? [page.id] : []
  ),
  plain: pages.filter((page) => page.plain !== undefined).length,
  snippet: pages.filter((page) => page.snippet !== undefined).length,
});

export const CardDiagnostic = Schema.Struct({
  id: Schema.String,
  reason: Schema.String,
});

export class InvalidLearnDeck extends Schema.TaggedError<
  InvalidLearnDeck,
  { readonly brand: unique symbol }
>()("InvalidLearnDeck", {
  errors: Schema.Array(CardDiagnostic),
}) {
  override get message() {
    return [
      `${this.errors.length} learn deck error(s):`,
      ...this.errors.map((error) => `- ${error.id}: ${error.reason}`),
    ].join("\n");
  }
}

const metadataWarnings = (page: CardSource) => [
  ...(page.terms.length === 0
    ? [
        {
          id: page.id,
          reason:
            "No terms. The deck builds term coverage only from terms the page declares. Fix: add `terms:` to the frontmatter, naming terms the page itself teaches.",
        },
      ]
    : []),
  ...(page.prerequisites.length === 0
    ? [
        {
          id: page.id,
          reason:
            "No explicit prerequisites. Links between pages do not tell the deck what to learn first. Fix: add `prerequisites:` to the frontmatter with the routes a reader needs first, such as `/lore/effect-basics`.",
        },
      ]
    : []),
];

const snippetFileDiagnostics = (
  snippetIds: readonly string[],
  ids: ReadonlySet<string>
) =>
  snippetIds.flatMap((id) =>
    ids.has(id)
      ? []
      : [
          {
            id,
            reason:
              "Snippet file names no concept. The deck attaches a snippet to the card whose id matches its file name. Fix: rename `.brain/data/learn-cards/<id>.ts` to an existing card id.",
          },
        ]
  );

const priorityDiagnostics = (
  priority: readonly string[],
  ids: ReadonlySet<string>
) =>
  priority.flatMap((id) =>
    !ids.has(id) || priority.filter((entry) => entry === id).length > 1
      ? [
          {
            id,
            reason:
              "Priority ids must be unique, existing concepts. The deck orders cards by this list, so an unknown or repeated id has no place. Fix: remove the id from the priority list or correct it to an existing card id, for example `lore.effect-basics`.",
          },
        ]
      : []
  );

const optOutWarnings = (candidates: readonly CardSource[]) =>
  candidates.flatMap((page) =>
    page.learn === false
      ? [
          {
            id: page.id,
            reason:
              "Opted out with learn: false. The page is not a learn card. Fix: delete `learn: false` from the frontmatter to make it one.",
          },
        ]
      : []
  );

export const deriveDeck = (
  candidates: readonly CardSource[],
  priority: readonly string[] = [],
  snippetIds: readonly string[] = []
) => {
  const errors: (typeof CardDiagnostic.Type)[] = [];
  const pages = candidates.filter((page) => page.learn !== false);
  const warnings: (typeof CardDiagnostic.Type)[] = optOutWarnings(candidates);
  const ids = new Set(pages.map((page) => page.id));
  const routes = new Map(pages.map((page) => [page.routePath, page.id]));
  const cards: Card[] = [];

  for (const page of pages) {
    const summary = page.card ?? page.description;

    if (summary.trim() === "") {
      errors.push({
        id: page.id,
        reason:
          "Missing summary. A card needs a summary to show under its claim. Fix: set `description:` or `card:` in the frontmatter.",
      });
    }

    if (page.sources.length === 0 && page.kind !== "skill") {
      errors.push({
        id: page.id,
        reason:
          "Missing reference. Every card claim points to evidence a learner can read. Fix: add a public `sources:` entry or a page reference to the frontmatter.",
      });
    }

    if (page.routePath.trim() === "") {
      errors.push({
        id: page.id,
        reason:
          "Missing public page route. A card links to the page that teaches it. Fix: publish the page under `.brain/` or `skills/` so it gets a route.",
      });
    }

    warnings.push(...metadataWarnings(page));
    errors.push(...teachingDiagnostics(page));

    const prerequisites = page.prerequisites.map((id) => routes.get(id) ?? id);

    for (const id of prerequisites) {
      if (!ids.has(id) || id === page.id) {
        errors.push({
          id: page.id,
          reason: `Unresolved or self prerequisite: ${id}. A prerequisite must name another published card. Fix: point \`prerequisites:\` at another page's route, such as \`/lore/effect-basics\`.`,
        });
      }
    }

    const candidate = {
      ...teachingOf(page),
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
          "Invalid card shape. The card failed `CardSchema`, so the deck cannot serve it. Fix: check the page's id, title, summary, references, route, and teaching fields against `CardSchema` in `packages/learn`.",
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

  errors.push(
    ...priorityDiagnostics(priority, ids),
    ...snippetFileDiagnostics(snippetIds, ids)
  );

  if (errors.length > 0) {
    throw new InvalidLearnDeck({ errors });
  }

  const order = new Map(priority.map((id, index) => [id, index]));

  return {
    cards: cards.toSorted(
      (a, b) =>
        (order.get(a.id) ?? priority.length) -
          (order.get(b.id) ?? priority.length) || a.id.localeCompare(b.id)
    ),
    coverage: teachingCoverage(pages),
    warnings,
  };
};
