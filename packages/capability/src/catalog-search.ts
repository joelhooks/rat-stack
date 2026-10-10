import { Option } from "effect";

import { parseNode, signatureOf } from "./catalog-model.js";
import type { Catalog, JsonSchemaNode } from "./catalog-model.js";

const tokens = (text: string): readonly string[] =>
  text
    .replaceAll(/(?<lower>[a-z])(?<upper>[A-Z])/gu, "$<lower> $<upper>")
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((token) => token.length > 0);

export interface SearchMatch {
  readonly name: string;
  readonly description: string;
  readonly score: number;
  readonly signature: string;
}

const inputText = (node: JsonSchemaNode): string =>
  [
    node.description ?? "",
    ...Object.entries(node.properties ?? {}).flatMap(([name, property]) => [
      name,
      inputText(property),
    ]),
    ...Object.values(node.$defs ?? {}).map(inputText),
    ...(node.anyOf ?? node.oneOf ?? []).map(inputText),
    ...(node.items === undefined ? [] : [inputText(node.items)]),
  ]
    .join("\n")
    .toLowerCase();

const termForms = (term: string): readonly string[] => [
  term,
  ...(term.endsWith("es") && term.length > 3 ? [term.slice(0, -2)] : []),
  ...(term.endsWith("s") && term.length > 2 ? [term.slice(0, -1)] : []),
];

export const searchCatalog = (
  catalog: Catalog,
  query: string,
  limit = 5,
  offset = 0
): readonly SearchMatch[] => {
  const trimmed = query.trim();
  const pathQuery = trimmed.startsWith("tools.") ? trimmed.slice(6) : trimmed;

  const exact = catalog.capabilities.find(
    (entry) =>
      entry.name === pathQuery ||
      `tools[${JSON.stringify(entry.name)}]` === trimmed
  );

  const wanted = [...new Set(tokens(query))].map(termForms);
  const candidates = exact === undefined ? catalog.capabilities : [exact];

  const scored = candidates.map((entry) => {
    const path = entry.name.toLowerCase();
    const segments = path.split(/[._-]/u);
    const description = entry.description.toLowerCase();

    const fields = Option.match(parseNode(entry.input), {
      onNone: () => "",
      onSome: inputText,
    });

    const score = wanted.reduce(
      (sum, forms) =>
        sum +
        (forms.some((form) => path === form || segments.includes(form))
          ? 20
          : 0) +
        (forms.some((form) => path.includes(form)) ? 8 : 0) +
        (forms.some((form) => description.includes(form)) ? 4 : 0) +
        (forms.some((form) => fields.includes(form)) ? 2 : 0),
      0
    );

    return {
      description: entry.description,
      name: entry.name,
      score,
      signature: signatureOf(entry),
    };
  });

  return scored
    .filter(
      (match) => exact !== undefined || wanted.length === 0 || match.score > 0
    )
    .toSorted((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(offset, offset + limit);
};
