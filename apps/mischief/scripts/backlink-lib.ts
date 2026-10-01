export interface BacklinkReference {
  readonly route: string;
  readonly title: string;
  readonly description: string;
  readonly context: string;
}

export interface BacklinkPage {
  readonly route: string;
  readonly title: string;
  readonly description: string;
  readonly bodyHtml: string;
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const markdownLabel = (value: string) =>
  value.replaceAll(/(?<character>[\\[\]<>])/gu, "\\$<character>");

const routeFor = (href: string) => {
  const route =
    href.replace(/^https:\/\/ratstack\.sh(?=\/)/u, "").split(/[?#]/u)[0] ?? "";

  return route.replace(/\.md$/u, "");
};

const plainText = (html: string) =>
  html
    .replaceAll(/<[^>]*>/gu, "")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll(/\s+/gu, " ")
    .trim();

export const backlinkContext = (html: string, target: string) => {
  for (const match of html.matchAll(
    /<(?:p|li)\b[^>]*>(?<body>[\s\S]*?)<\/(?:p|li)>/gu
  )) {
    const body = match.groups?.body ?? "";

    const link = [
      ...body.matchAll(/<a\b[^>]*href="(?<href>[^"]+)"[^>]*>/gu),
    ].find((anchor) => routeFor(anchor.groups?.href ?? "") === target);

    if (link === undefined) {
      continue;
    }

    const before = plainText(body.slice(0, link.index));
    const after = plainText(body.slice(link.index));
    const sentenceStart = before.search(/[^.!?]*$/u);

    const sentence =
      `${before.slice(sentenceStart)} ${after.split(/(?<=[.!?])\s/u)[0] ?? ""}`.trim();

    return sentence.length > 480
      ? `${sentence.slice(0, 477).trimEnd()}…`
      : sentence;
  }

  return "";
};

export const buildBacklinkIndex = (
  pages: readonly BacklinkPage[],
  links: readonly { readonly from: string; readonly to: string }[]
): ReadonlyMap<string, readonly BacklinkReference[]> => {
  const byRoute = new Map(pages.map((page) => [page.route, page]));
  const index = new Map<string, BacklinkReference[]>();

  for (const { from, to } of links) {
    const page = byRoute.get(from);
    const entries = index.get(to) ?? [];

    if (
      from === to ||
      page === undefined ||
      entries.some((entry) => entry.route === from)
    ) {
      continue;
    }

    entries.push({
      context: backlinkContext(page.bodyHtml, to),
      description: page.description,
      route: from,
      title: page.title,
    });
    index.set(to, entries);
  }

  for (const entries of index.values()) {
    entries.sort((left, right) => left.title.localeCompare(right.title));
  }

  return index;
};

const renderContext = (context: string) => {
  if (context === "") {
    return "";
  }

  const text = `<p>${escapeHtml(context)}</p>`;

  return context.length > 160
    ? `<details><summary>Link context</summary>${text}</details>`
    : text;
};

export const renderBacklinks = (entries: readonly BacklinkReference[]) => ({
  html:
    entries.length === 0
      ? ""
      : `<section class="bibliography linked-from" aria-labelledby="linked-from"><h2 id="linked-from">Linked from</h2><ol>${entries.map((entry) => `<li><a href="${escapeHtml(entry.route)}">${escapeHtml(entry.title)}</a>. ${escapeHtml(entry.description)}${renderContext(entry.context)}</li>`).join("")}</ol></section>`,
  markdown:
    entries.length === 0
      ? ""
      : `\n\n## Linked from\n\n${entries.map((entry) => `- ${markdownLabel(entry.title)} → ${markdownLabel(entry.description)} → [Read page](<https://ratstack.sh${entry.route}>)`).join("\n")}\n`,
});

const skippedCountTags = new Set([
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "nav",
  "table",
  "code",
  "pre",
  "script",
  "style",
]);

export const addInboundCounts = (
  html: string,
  route: string,
  index: ReadonlyMap<string, readonly BacklinkReference[]>
) => {
  const skipped: string[] = [];

  return html.replaceAll(
    /<section\b[^>]*class="[^"]*\bbibliography\b[^"]*"[^>]*>[\s\S]*?<\/section>|<a\b[^>]*>[\s\S]*?<\/a>|<\/?[a-z][^>]*>/giu,
    (token) => {
      const tag = /^<(?<closing>\/)?(?<name>[a-z][\w-]*)/iu.exec(token);
      const name = tag?.groups?.name?.toLowerCase() ?? "";

      if (skippedCountTags.has(name)) {
        if (tag?.groups?.closing === undefined) {
          skipped.push(name);
        } else if (skipped.at(-1) === name) {
          skipped.pop();
        }
      }

      if (name !== "a" || skipped.length > 0) {
        return token;
      }

      const href = /\bhref="(?<href>[^"]+)"/u.exec(token)?.groups?.href ?? "";
      const target = routeFor(href);
      const count = index.get(target)?.length ?? 0;

      if (
        target === route ||
        !/^\/(?:lore|systems|skills)\//u.test(target) ||
        count < 2
      ) {
        return token;
      }

      return `${token}<sup class="inbound-count"><a href="${escapeHtml(target)}#linked-from" aria-label="${count} pages link here">${count}</a></sup>`;
    }
  );
};
