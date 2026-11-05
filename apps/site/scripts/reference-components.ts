import { Schema } from "effect";
import type { RootContent } from "mdast";

import type { BacklinkReference } from "./backlink-lib.ts";
import type {
  ComponentDefinition,
  ComponentInput,
} from "./component-registry.ts";
import type { UnlinkedMention } from "./unlinked-mentions.ts";

export const groupUnlinkedMentions = (
  mentions: readonly UnlinkedMention[]
): ReadonlyMap<string, readonly UnlinkedMention[]> => {
  const records = new Map<string, UnlinkedMention[]>();

  for (const mention of mentions) {
    const entries = records.get(mention.target) ?? [];
    entries.push(mention);
    records.set(mention.target, entries);
  }

  return records;
};

const pageAttributes = Schema.Struct({ page: Schema.String });

const pageFor = (input: ComponentInput) =>
  Schema.decodeUnknownSync(pageAttributes)(input.attributes).page;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const html = (value: string): RootContent => ({ type: "html", value });

const heading = (value: string): RootContent => ({
  children: [{ type: "text", value }],
  depth: 2,
  type: "heading",
});

export const linkedFromComponent = (
  records: ReadonlyMap<string, readonly BacklinkReference[]>
): ComponentDefinition => ({
  agent(input, context) {
    const entries = records.get(pageFor(input)) ?? [];

    if (entries.length === 0) {
      return [];
    }

    return [
      heading("Linked from"),
      {
        children: entries.map((entry) => ({
          children: [
            {
              children: [
                {
                  type: "text",
                  value: `${entry.title} → ${entry.description} → `,
                },
                {
                  children: [{ type: "text", value: "Read page" }],
                  type: "link",
                  url: `${context.origin}${entry.route}`,
                },
              ],
              type: "paragraph",
            },
          ],
          type: "listItem",
        })),
        ordered: false,
        type: "list",
      },
    ];
  },
  human(input) {
    const entries = records.get(pageFor(input)) ?? [];

    return entries.length === 0
      ? []
      : [
          html(
            `<section class="referenced-by" aria-labelledby="linked-from"><h2 id="linked-from">Referenced by <span class="reference-count">${entries.length}</span></h2><ul class="reference-cards">${entries.map((entry) => `<li><a class="reference-card" href="${escapeHtml(entry.route)}"><span class="reference-route">${escapeHtml(entry.route)}</span> <strong class="reference-title">${escapeHtml(entry.title)}</strong> ${entry.context === "" ? `<span class="reference-description">${escapeHtml(entry.description)}</span>` : `<span class="reference-context">${escapeHtml(entry.context)}</span>`}</a></li>`).join("")}</ul></section>`
          ),
        ];
  },
});

export const unlinkedMentionsComponent = (
  records: ReadonlyMap<string, readonly UnlinkedMention[]>
): ComponentDefinition => ({
  agent(input, context) {
    const entries = records.get(pageFor(input)) ?? [];

    if (entries.length === 0) {
      return [];
    }

    return [
      heading("Unlinked mentions"),
      {
        children: entries.map((entry) => ({
          children: [
            {
              children: [
                {
                  children: [{ type: "text", value: entry.title }],
                  type: "link",
                  url: `${context.origin}${entry.from}`,
                },
                { type: "text", value: ` → ${entry.context}` },
              ],
              type: "paragraph",
            },
          ],
          type: "listItem",
        })),
        ordered: false,
        type: "list",
      },
    ];
  },
  human(input) {
    const entries = records.get(pageFor(input)) ?? [];

    return entries.length === 0
      ? []
      : [
          html(
            `<section class="bibliography unlinked-mentions"><details><summary>Unlinked mentions (${entries.length})</summary><ul>${entries.map((entry) => `<li><a href="${escapeHtml(entry.from)}">${escapeHtml(entry.title)}</a> → ${escapeHtml(entry.context)}</li>`).join("")}</ul></details></section>`
          ),
        ];
  },
});
