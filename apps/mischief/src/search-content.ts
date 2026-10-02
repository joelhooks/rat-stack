import type { SearchResource } from "./content-data.js";

type ContentKind = "law" | "skill" | "lore";

export interface SearchMatch {
  readonly description: string;
  readonly digest: string;
  readonly excerpt: string;
  readonly id: string;
  readonly kind: ContentKind;
  readonly routePath: `/${string}`;
  readonly score: number;
  readonly title: string;
}

const occurrences = (value: string, term: string) => {
  if (term === "") {
    return 0;
  }

  let count = 0;
  let offset = 0;

  while ((offset = value.indexOf(term, offset)) !== -1) {
    count += 1;
    offset += term.length;
  }

  return count;
};

const excerptAround = (text: string, query: string) => {
  const normalized = text.toLowerCase();
  const index = normalized.indexOf(query.toLowerCase());
  const start = Math.max(0, index === -1 ? 0 : index - 90);

  const excerpt = text
    .slice(start, start + 260)
    .replaceAll(/\s+/gu, " ")
    .trim();

  return `${start > 0 ? "…" : ""}${excerpt}${start + 260 < text.length ? "…" : ""}`;
};

export const searchContent = (
  contentResources: readonly (typeof SearchResource.Type)[],
  query: string,
  requestedLimit = 5
): readonly SearchMatch[] => {
  const terms = query
    .toLowerCase()
    .split(/[^a-z0-9@._/-]+/u)
    .filter((term) => term.length > 1);

  const limit = Math.max(1, Math.min(20, Math.trunc(requestedLimit)));
  const queryText = terms.join(" ");

  return contentResources
    .flatMap((resource) => {
      const title = resource.title.toLowerCase();
      const description = resource.description.toLowerCase();
      const text = resource.text.toLowerCase();

      const loreTerms =
        resource.kind === "lore" ? resource.terms.join(" ").toLowerCase() : "";

      const score =
        (queryText !== "" && title.includes(queryText) ? 40 : 0) +
        terms.reduce(
          (total, term) =>
            total +
            occurrences(title, term) * 12 +
            occurrences(loreTerms, term) * 12 +
            occurrences(description, term) * 6 +
            Math.min(10, occurrences(text, term)),
          0
        );

      return queryText === "" || score > 0 ? [{ resource, score }] : [];
    })
    .toSorted(
      (left, right) =>
        right.score - left.score ||
        left.resource.title.localeCompare(right.resource.title)
    )
    .slice(0, limit)
    .map(({ resource, score }) => ({
      description: resource.description,
      digest: resource.digest,
      excerpt: excerptAround(resource.text, queryText),
      id: resource.id,
      kind: resource.kind,
      routePath: resource.routePath,
      score,
      title: resource.title,
    }));
};
