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
    reason: "Plain line must be one line of at most 160 characters.",
    schema: PlainLineSchema,
  },
  {
    field: "snippet",
    reason: `Snippet must be non-empty with at most ${SNIPPET_LINES} lines.`,
    schema: SnippetSchema,
  },
  {
    field: "diagram",
    reason: `Diagram must fit ${DIAGRAM_COLUMNS} columns and ${DIAGRAM_ROWS} rows of one-column characters; replace tabs, emoji, wide CJK and combining marks.`,
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
    reason: `Snippet does not compile: ${diagnostic}`,
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

export class InvalidLearnDeck extends Schema.TaggedError<InvalidLearnDeck>()(
  "InvalidLearnDeck",
  {
    errors: Schema.Array(CardDiagnostic),
  }
) {
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
          reason: "No terms; coverage needs source-grounded metadata.",
        },
      ]
    : []),
  ...(page.prerequisites.length === 0
    ? [
        {
          id: page.id,
          reason:
            "No explicit prerequisites; graph links are not prerequisites.",
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
              "Snippet file names no concept; rename it to an existing card id.",
          },
        ]
  );

const priorityDiagnostics = (
  priority: readonly string[],
  ids: ReadonlySet<string>
) =>
  priority.flatMap((id) =>
    !ids.has(id) || priority.filter((entry) => entry === id).length > 1
      ? [{ id, reason: "Priority ids must be unique, existing concepts." }]
      : []
  );

export const deriveDeck = (
  pages: readonly CardSource[],
  priority: readonly string[] = [],
  snippetIds: readonly string[] = []
) => {
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

    warnings.push(...metadataWarnings(page));
    errors.push(...teachingDiagnostics(page));

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
          "Invalid card shape; check id, claim, summary, references, route and teaching fields.",
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
