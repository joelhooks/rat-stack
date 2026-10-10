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

const renderContext = (context: string) => {
  if (context === "") {
    return "";
  }

  const text = `<p>${escapeHtml(context)}</p>`;

  return context.length > 160
    ? `<details><summary>Link context</summary>${text}</details>`
    : text;
};

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
            `<section class="bibliography linked-from" aria-labelledby="linked-from"><h2 id="linked-from">Linked from</h2><ol>${entries.map((entry) => `<li><a href="${escapeHtml(entry.route)}">${escapeHtml(entry.title)}</a>. ${escapeHtml(entry.description)}${renderContext(entry.context)}</li>`).join("")}</ol></section>`
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
