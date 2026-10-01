import { Schema } from "effect";

const tierLetters = new Set(["S", "A", "B", "C", "D", "E", "F"]);

const tierOfCell = (header: string, text: string) =>
  header === "Tier" && tierLetters.has(text) ? text : undefined;

export class ContentBuildError extends Schema.TaggedError<ContentBuildError>()(
  "ContentBuildError",
  {
    cause: Schema.Defect(),
    sourcePath: Schema.String,
    stage: Schema.String,
  }
) {
  override get message() {
    return `${this.stage} failed for ${this.sourcePath}`;
  }
}

export const buildError = (stage: string, sourcePath: string, cause: unknown) =>
  new ContentBuildError({ cause, sourcePath, stage });

export interface ResponsiveTableNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  properties?: Record<
    string,
    boolean | number | string | null | undefined | readonly (string | number)[]
  >;
  children?: ResponsiveTableNode[];
}

const responsiveTableText = (node: ResponsiveTableNode): string =>
  node.value ?? (node.children ?? []).map(responsiveTableText).join("");

const tableChildren = (node: ResponsiveTableNode, tagName: string) =>
  (node.children ?? []).filter((child) => child.tagName === tagName);

const childrenOfTable = (node: ResponsiveTableNode) =>
  (node.children ?? []).filter((child) =>
    ["thead", "tbody", "tfoot"].includes(child.tagName ?? "")
  );

export const responsiveTables = () => {
  let heading = "";

  const visit = (node: ResponsiveTableNode): void => {
    if (node.tagName !== undefined && /^h[1-6]$/u.test(node.tagName)) {
      heading = responsiveTableText(node).trim();
    }

    const children = node.children ?? [];

    for (const [index, child] of children.entries()) {
      if (child.tagName !== "table") {
        visit(child);
        continue;
      }

      const headers = tableChildren(child, "thead")
        .flatMap((section) => tableChildren(section, "tr"))
        .flatMap((row) => tableChildren(row, "th"))
        .map(responsiveTableText);

      const caption = tableChildren(child, "caption")
        .map(responsiveTableText)
        .join("")
        .trim();

      const label = caption || heading || headers.join(" / ") || "Data";
      child.properties = { ...child.properties, role: "table" };

      for (const section of childrenOfTable(child)) {
        section.properties = { ...section.properties, role: "rowgroup" };

        for (const row of tableChildren(section, "tr")) {
          row.properties = { ...row.properties, role: "row" };

          for (const cell of tableChildren(row, "th")) {
            cell.properties = {
              ...cell.properties,
              role: "columnheader",
              scope: "col",
            };
          }

          for (const [column, cell] of tableChildren(row, "td").entries()) {
            const header = headers[column]?.trim() ?? "";
            const text = responsiveTableText(cell).trim();
            const tier = tierOfCell(header, text);

            cell.properties = {
              ...cell.properties,
              dataLabel: header === "" ? `Column ${column + 1}` : header,
              role: "cell",
            };

            if (/^(?:[@\w./-]+)(?:\s[=≠])?[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/u.test(text)) {
              cell.properties.className = ["table-token"];
            }

            if (tier !== undefined) {
              cell.properties.dataTier = tier;
            }
          }
        }
      }

      children[index] = {
        children: [child],
        properties: {
          ariaLabel: `${label} table`,
          className:
            headers.length >= 6
              ? ["table-wrapper", "table-wide"]
              : ["table-wrapper"],
          role: "region",
          tabIndex: 0,
        },
        tagName: "div",
        type: "element",
      };
    }
  };

  return visit;
};

export type LoreGroup = "idea" | "concept" | "source" | "person" | "system";

export const SYSTEMS_DIRECTORY = ".brain/areas";

export const sectionOf = (group: LoreGroup) =>
  group === "system"
    ? ({ href: "/systems", kind: "System", label: "systems" } as const)
    : ({ href: "/lore", kind: "Lore", label: "lore" } as const);

export const SYSTEM_SECTIONS = [
  "What it does",
  "The standard",
  "How to check",
] as const;

export interface LoreTermTarget {
  readonly routePath: string;
  readonly term: string;
}

const bibliographySourceSchema = Schema.Struct({
  accessed: Schema.String,
  note: Schema.String,
  publisher: Schema.String,
  title: Schema.String,
  url: Schema.String,
});

export type BibliographySource = typeof bibliographySourceSchema.Type;

export interface LorePageMetadata {
  readonly bibliography: readonly BibliographySource[];
  readonly date?: string;
  readonly description: string;
  readonly group: LoreGroup;
  readonly routePath: `/lore/${string}` | `/systems/${string}`;
  readonly slug: string;
  readonly sourcePath: string;
  readonly sources: readonly string[];
  readonly speaker?: string;
  readonly terms: readonly string[];
  readonly title: string;
  readonly url?: string;
}

const loreFrontmatterSchema = Schema.Struct({
  date: Schema.optional(Schema.String),
  description: Schema.String,
  group: Schema.Literals(["idea", "concept", "source", "person", "system"]),
  sources: Schema.Array(
    Schema.Union([Schema.String, bibliographySourceSchema])
  ),
  speaker: Schema.optional(Schema.String),
  terms: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.String,
  url: Schema.optional(Schema.String),
});

const loreScalar = (frontmatter: string, field: string) => {
  const match = new RegExp(
    `^${field}:[ \\t]*(?:"(?<double>(?:[^"\\\\]|\\\\.)*)"|'(?<single>(?:[^']|'')*)'|(?<plain>[^\\r\\n]+))$`,
    "mu"
  ).exec(frontmatter);

  const double = match?.groups?.double;

  if (double !== undefined) {
    return Schema.decodeUnknownSync(Schema.String)(JSON.parse(`"${double}"`));
  }

  return match?.groups?.single?.replaceAll("''", "'") ?? match?.groups?.plain;
};

const loreList = (frontmatter: string, field: string, sourcePath: string) => {
  const lines = frontmatter.split(/\r?\n/u);

  const fieldLine = lines.findIndex((line) =>
    new RegExp(`^${field}:[ \\t]*`, "u").test(line)
  );

  if (fieldLine === -1) {
    return [];
  }

  const inline = lines[fieldLine]?.slice(field.length + 1).trim();

  if (inline === "[]") {
    return [];
  }

  if (inline !== "") {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error(`${field} must be a list`)
    );
  }

  const values: string[] = [];

  for (const line of lines.slice(fieldLine + 1)) {
    const item = /^[ \t]+-[ \t]*(?<value>.+?)[ \t]*$/u.exec(line)?.groups
      ?.value;

    if (item === undefined) {
      break;
    }

    let value = item;

    if (item.startsWith('"') && item.endsWith('"')) {
      value = item.slice(1, -1).replaceAll('\\"', '"');
    } else if (item.startsWith("'") && item.endsWith("'")) {
      value = item.slice(1, -1).replaceAll("''", "'");
    }

    values.push(value);
  }

  return values;
};

const loreSources = (frontmatter: string, sourcePath: string) => {
  const block =
    /^sources:[ \t]*\r?\n(?<entries>(?:[ \t]+[^\r\n]*\r?\n?)*)/mu.exec(
      frontmatter
    )?.groups?.entries;

  if (block === undefined) {
    return loreList(frontmatter, "sources", sourcePath);
  }

  return block
    .split(/^[ \t]+-[ \t]+/mu)
    .slice(1)
    .map((entry) => {
      if (!/^[a-z]+:/u.test(entry) || entry.startsWith("https:")) {
        return loreScalar(`value: ${entry.trim()}`, "value");
      }

      const fields = entry.replaceAll(/^[ \t]+/gmu, "");

      return {
        accessed: loreScalar(fields, "accessed"),
        note: loreScalar(fields, "note"),
        publisher: loreScalar(fields, "publisher"),
        title: loreScalar(fields, "title"),
        url: loreScalar(fields, "url"),
      };
    });
};

export const frontmatterTerms = (rawText: string, sourcePath: string) => {
  const frontmatter =
    /^---[ \t]*\r?\n(?<fields>[\s\S]*?)\r?\n---/u.exec(rawText)?.groups
      ?.fields ?? "";

  return loreList(frontmatter, "terms", sourcePath);
};

type LoreFrontmatter = typeof loreFrontmatterSchema.Type;

type MutableLorePageMetadata = {
  -readonly [Key in keyof LorePageMetadata]: LorePageMetadata[Key];
};

const decodeLoreFrontmatter = (
  sourcePath: string,
  frontmatter: string
): LoreFrontmatter => {
  try {
    return Schema.decodeUnknownSync(loreFrontmatterSchema)({
      date: loreScalar(frontmatter, "date"),
      description: loreScalar(frontmatter, "description"),
      group: loreScalar(frontmatter, "group"),
      sources: loreSources(frontmatter, sourcePath),
      speaker: loreScalar(frontmatter, "speaker"),
      terms: loreList(frontmatter, "terms", sourcePath),
      title: loreScalar(frontmatter, "title"),
      url: loreScalar(frontmatter, "url"),
    });
  } catch (error) {
    if (Schema.is(ContentBuildError)(error)) {
      throw error;
    }

    throw buildError("frontmatter", sourcePath, error);
  }
};

const validateLoreDescription = (
  sourcePath: string,
  decoded: LoreFrontmatter
) => {
  if (decoded.title.trim() === "" || decoded.description.trim() === "") {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("title and description must not be empty")
    );
  }

  if (decoded.description.match(/[.!?](?=\s|$)/gu)?.length !== 1) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("description must be one sentence ending in punctuation")
    );
  }
};

const validateSystemPlacement = (
  sourcePath: string,
  decoded: LoreFrontmatter,
  rawText: string
) => {
  const inSystems = sourcePath.startsWith(`${SYSTEMS_DIRECTORY}/`);

  if (inSystems !== (decoded.group === "system")) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error(
        `system pages live in ${SYSTEMS_DIRECTORY} with group: system, and nothing else does`
      )
    );
  }

  if (!inSystems) {
    return;
  }

  const headings = new Set(
    [...rawText.matchAll(/^## (?<heading>.+?)[ \t]*$/gmu)].map(
      (match) => match.groups?.heading
    )
  );

  const missing = SYSTEM_SECTIONS.filter((section) => !headings.has(section));

  if (missing.length > 0) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error(`system pages need sections: ${missing.join(", ")}`)
    );
  }
};

const validateLoreGroup = (sourcePath: string, decoded: LoreFrontmatter) => {
  if (decoded.group !== "source") {
    return;
  }

  if (
    decoded.speaker?.trim() === undefined ||
    decoded.speaker.trim() === "" ||
    decoded.date === undefined ||
    !/^\d{4}-\d{2}-\d{2}$/u.test(decoded.date) ||
    decoded.url === undefined
  ) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("source pages require speaker, date, and recording url")
    );
  }
};

const validateLoreTerms = (sourcePath: string, decoded: LoreFrontmatter) => {
  const terms = decoded.terms ?? [];

  if (decoded.group !== "source" && terms.length === 0) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error(`${decoded.group} pages must declare terms`)
    );
  }

  if (terms.some((term) => term.trim() === "")) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("terms must not contain an empty value")
    );
  }

  return terms;
};

const validateLoreSources = (sourcePath: string, decoded: LoreFrontmatter) => {
  for (const source of [
    ...decoded.sources.map((entry) =>
      Schema.is(Schema.String)(entry) ? entry : entry.url
    ),
    ...(decoded.url === undefined ? [] : [decoded.url]),
  ]) {
    let parsed: URL;

    try {
      parsed = new URL(source);
    } catch (error) {
      throw buildError("frontmatter", sourcePath, error);
    }

    if (parsed.protocol !== "https:") {
      throw buildError(
        "frontmatter",
        sourcePath,
        new Error(`source must be a public HTTPS URL: ${source}`)
      );
    }
  }
};

export const parseLorePage = (
  sourcePath: string,
  rawText: string
): LorePageMetadata => {
  const filename = sourcePath.split("/").at(-1) ?? "";
  const slug = filename.endsWith(".svx") ? filename.slice(0, -4) : "";

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(slug)) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("lore filename must be a lowercase kebab-case .svx slug")
    );
  }

  const block =
    /^---[ \t]*\r?\n(?<frontmatter>[\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/u.exec(
      rawText
    )?.groups?.frontmatter;

  if (block === undefined) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("missing YAML frontmatter")
    );
  }

  const decoded = decodeLoreFrontmatter(sourcePath, block);
  validateLoreDescription(sourcePath, decoded);

  const terms = validateLoreTerms(sourcePath, decoded);

  validateLoreGroup(sourcePath, decoded);
  validateSystemPlacement(sourcePath, decoded, rawText);
  validateLoreSources(sourcePath, decoded);

  const bibliography = decoded.sources.map((source) => {
    if (
      Schema.is(Schema.String)(source) ||
      [source.title, source.note, source.publisher].some(
        (value) => value.trim() === "" || /[\r\n]/u.test(value)
      ) ||
      !/^\d{4}-\d{2}-\d{2}$/u.test(source.accessed) ||
      /https?:\/\//u.test(source.title)
    ) {
      throw buildError(
        "bibliography",
        sourcePath,
        new Error(
          "every source requires title, publisher, note, and accessed date; enrich legacy URL strings before building"
        )
      );
    }

    return source;
  });

  const metadata: MutableLorePageMetadata = {
    bibliography,
    description: decoded.description,
    group: decoded.group,
    routePath:
      decoded.group === "system" ? `/systems/${slug}` : `/lore/${slug}`,
    slug,
    sourcePath,
    sources: bibliography.map((source) => source.url),
    terms,
    title: decoded.title,
  };

  if (decoded.date !== undefined) {
    metadata.date = decoded.date;
  }

  if (decoded.speaker !== undefined) {
    metadata.speaker = decoded.speaker;
  }

  if (decoded.url !== undefined) {
    metadata.url = decoded.url;
  }

  return metadata;
};

export const assertLoreTerms = (
  pages: readonly Pick<LorePageMetadata, "sourcePath" | "terms">[]
): void => {
  const owners = new Map<string, string>();

  for (const page of pages) {
    for (const term of page.terms) {
      const normalized = term.trim().toLowerCase();
      const previousPath = owners.get(normalized);

      if (previousPath !== undefined) {
        throw buildError(
          "lore terms",
          `${page.sourcePath} (previous claimant: ${previousPath})`,
          new Error(`term "${term}" is claimed by multiple pages`)
        );
      }

      owners.set(normalized, page.sourcePath);
    }
  }
};

export interface GlossaryEntry {
  readonly term: string;
  readonly summary: string;
  readonly routePath: string;
}

interface GlossaryPage {
  readonly title: string;
  readonly description: string;
  readonly routePath: string;
  readonly terms: readonly string[];
}

const glossaryNounRoutes = new Map([
  ["Contract", "/systems/capabilities"],
  ["Capability", "/systems/capabilities"],
  ["Projection", "/lore/one-capability-every-surface"],
  ["Cartridge", "/lore/cartridges"],
  ["Machine", "/lore/lifecycles-are-machines"],
  ["Feature", "/skills/uncomplect"],
  ["Client", "/skills/uncomplect"],
]);

export const glossaryEntries = (
  pages: readonly GlossaryPage[],
  agents: string
): readonly GlossaryEntry[] => {
  const entries = new Map<string, GlossaryEntry>();

  const add = (entry: GlossaryEntry) =>
    entries.set(entry.term.trim().toLowerCase(), entry);

  for (const page of pages) {
    add({
      routePath: page.routePath,
      summary: page.description,
      term: page.title,
    });
  }

  for (const page of pages) {
    for (const term of page.terms) {
      add({ routePath: page.routePath, summary: page.description, term });
    }
  }

  for (const [term, routePath] of glossaryNounRoutes) {
    const summary = agents
      .split(/\r?\n/u)
      .find((line) => line.startsWith(`| ${term} |`))
      ?.split("|")
      .at(3)
      ?.trim();

    if (summary === undefined || summary === "") {
      throw buildError(
        "glossary noun",
        "AGENTS.md",
        new Error(`Missing noun: ${term}`)
      );
    }

    add({ routePath, summary, term });
  }

  for (const [term, routePath] of [
    ["port", "/lore/hexagonal-architecture"],
    ["adapter", "/lore/hexagonal-architecture"],
    ["Layer", "/lore/layer-constructor-pattern"],
  ]) {
    const page = pages.find((candidate) => candidate.routePath === routePath);

    if (page !== undefined && term !== undefined) {
      add({ routePath: page.routePath, summary: page.description, term });
    }
  }

  return [...entries.values()].toSorted((left, right) =>
    left.term.localeCompare(right.term, "en", { sensitivity: "base" })
  );
};

export const assertGlossaryLinks = (
  entries: readonly GlossaryEntry[],
  pageRoutes: ReadonlySet<string>
): void => {
  for (const entry of entries) {
    if (!pageRoutes.has(entry.routePath)) {
      throw buildError(
        "glossary link",
        entry.term,
        new Error(`Missing page: ${entry.routePath}`)
      );
    }
  }
};

export const glossaryAgentMarkdown = (entries: readonly GlossaryEntry[]) =>
  [
    "# Glossary",
    "",
    ...entries.map(
      (entry) => `- ${entry.term} → ${entry.summary} → ${entry.routePath}`
    ),
    "",
  ].join("\n");

export const glossaryMarkdown = (entries: readonly GlossaryEntry[]) => {
  const lines = ["# Glossary", ""];
  let previousLetter = "";

  for (const entry of entries) {
    const letter = entry.term.charAt(0).toUpperCase();

    if (letter !== previousLetter) {
      lines.push(`## ${letter}`, "");
      previousLetter = letter;
    }

    lines.push(`- [${entry.term}](${entry.routePath}) → ${entry.summary}`, "");
  }

  return lines.join("\n");
};

export const loreTermTargets = (
  pages: readonly Pick<LorePageMetadata, "routePath" | "terms">[]
): readonly LoreTermTarget[] =>
  pages.flatMap((page) =>
    page.terms.map((term) => ({ routePath: page.routePath, term }))
  );

const escapedRegex = (value: string) =>
  value.replaceAll(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const loreTermPattern = (targets: readonly LoreTermTarget[]) => {
  const terms = targets
    .map((target) => target.term)
    .toSorted((left, right) => right.length - left.length);

  return new RegExp(
    `(?<![\\p{L}\\p{N}_])(?<term>${terms.map(escapedRegex).join("|")})(?![\\p{L}\\p{N}_])`,
    "giu"
  );
};

interface LoreHastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  children?: LoreHastNode[];
  properties?: { readonly href?: string };
}

export const isPlainEffect = (term: string, precedingText: string) =>
  term.toLowerCase() === "effect" &&
  (term !== "Effect" || /(?:^|[.!?]\s*)$/u.test(precedingText.trim()));

const matchesLoreTermForm = (
  target: LoreTermTarget,
  term: string | undefined,
  precedingText: string
) =>
  target.term.toLowerCase() !== "effect" ||
  (term === target.term && !isPlainEffect(term, precedingText));

const skippedByLoreLinker = new Set(["a", "code", "pre", "th"]);

export const linkLoreTerms = (
  targets: readonly LoreTermTarget[],
  selfRoute: string,
  linkedRoutes: Set<string>,
  limit = 12,
  wovenTerms: Map<string, string> = new Map<string, string>()
) => {
  const byTerm = new Map(
    targets.map((target) => [target.term.toLowerCase(), target])
  );

  const linkedTerms = new Set<string>();
  const linkedTermRoutes = new Set<string>();
  const pattern = loreTermPattern(targets);

  const visit = (node: LoreHastNode, linked: number): number => {
    if (
      node.tagName !== undefined &&
      (skippedByLoreLinker.has(node.tagName) || /^h[1-6]$/u.test(node.tagName))
    ) {
      return linked;
    }

    const children = node.children ?? [];
    let count = linked;

    for (let index = 0; index < children.length && count < limit; index += 1) {
      const child = children[index];

      if (child === undefined) {
        continue;
      }

      if (child.type !== "text" || child.value === undefined) {
        count = visit(child, count);
        continue;
      }

      const replacement: LoreHastNode[] = [];
      let cursor = 0;

      for (const match of child.value.matchAll(pattern)) {
        const term = match.groups?.term;

        const target =
          term === undefined ? undefined : byTerm.get(term.toLowerCase());

        const start = match.index;

        if (
          target === undefined ||
          !matchesLoreTermForm(target, term, child.value.slice(0, start)) ||
          target.routePath === selfRoute ||
          linkedTerms.has(target.term.toLowerCase()) ||
          linkedTermRoutes.has(target.routePath) ||
          start === undefined
        ) {
          continue;
        }

        const end = start + match[0].length;
        replacement.push(
          { type: "text", value: child.value.slice(cursor, start) },
          {
            children: [{ type: "text", value: child.value.slice(start, end) }],
            properties: { href: target.routePath },
            tagName: "a",
            type: "element",
          }
        );
        cursor = end;
        count += 1;
        linkedTerms.add(target.term.toLowerCase());
        linkedTermRoutes.add(target.routePath);
        linkedRoutes.add(target.routePath);
        wovenTerms.set(target.routePath, target.term);
      }

      if (replacement.length > 0) {
        replacement.push({ type: "text", value: child.value.slice(cursor) });
        children.splice(index, 1, ...replacement);
        index += replacement.length - 1;
      }
    }

    return count;
  };

  return () => (tree: LoreHastNode) => {
    visit(tree, 0);
  };
};

export const loreLinkTargets = (
  sourcePath: string,
  markdown: string,
  knownRoutes: ReadonlySet<string>
): readonly string[] => {
  const body = markdown
    .replaceAll("__RATSTACK_ORIGIN__", "https://ratstack.sh")
    .replaceAll(/```[\s\S]*?```/gu, "")
    .replaceAll(/`[^`\n]+`/gu, "");

  const targets = new Set<string>();

  const links =
    /\[[^\]]+\]\((?<href>(?:https:\/\/ratstack\.sh)?\/(?:lore|systems)\/[^)\s]+)(?:\s+[^)]*)?\)/gu;

  for (const match of body.matchAll(links)) {
    const href = match.groups?.href;

    if (href === undefined) {
      continue;
    }

    const route = new URL(href, "https://ratstack.sh").pathname.replace(
      /\/$/u,
      ""
    );

    if (!knownRoutes.has(route)) {
      throw buildError(
        "lore link",
        sourcePath,
        new Error(`linked lore page does not exist: ${route}`)
      );
    }

    targets.add(route);
  }

  return [...targets];
};

export interface DebtEntry {
  readonly directive: string;
  readonly file: string;
  readonly kind: string;
  readonly line: number;
  readonly reason: string | undefined;
}

const DebtKind = Schema.Literals([
  "effect-diagnostics",
  "oxlint",
  "typescript",
]);

const DebtDiagnosticPayload = Schema.Struct({
  directive: Schema.String,
  kind: DebtKind,
  reason: Schema.optional(Schema.String),
});

const DebtLintSpan = Schema.Struct({
  column: Schema.Finite,
  length: Schema.Finite,
  line: Schema.Finite,
  offset: Schema.Finite,
});

const DebtLintDiagnostic = Schema.Struct({
  code: Schema.String,
  filename: Schema.String,
  labels: Schema.Array(Schema.Struct({ span: DebtLintSpan })),
  message: Schema.String,
  severity: Schema.Literals(["error", "warning"]),
});

const DebtLintOutput = Schema.Struct({
  diagnostics: Schema.Array(DebtLintDiagnostic),
  number_of_files: Schema.Finite,
  number_of_rules: Schema.Finite,
  start_time: Schema.Finite,
  threads_count: Schema.Finite,
});

export interface DebtLintResult {
  readonly entries: readonly DebtEntry[];
  readonly fileCount: number;
  readonly ruleCount: number;
}

export const assertSkillGroups = (
  skillNames: readonly string[],
  groups: readonly { readonly names: readonly string[] }[]
): void => {
  const groupedNames = new Set(groups.flatMap((group) => group.names));

  const ungrouped = skillNames
    .toSorted()
    .find((name) => !groupedNames.has(name));

  if (ungrouped !== undefined) {
    throw buildError(
      "skill grouping",
      `skills/${ungrouped}/SKILL.md`,
      new Error(`Skill ${ungrouped} does not belong to a home-page group`)
    );
  }
};

export const isDebtSourcePath = (file: string) => {
  const segments = file.split("/");

  const excludedSegments = new Set([
    ".agent_sources",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "generated",
    "node_modules",
    "vendor",
  ]);

  if (
    segments.some((segment) => excludedSegments.has(segment)) ||
    file.startsWith("tools/oxlint/anti-slop/") ||
    /(?:\.generated|\.gen)\.[^.]+$/u.test(file)
  ) {
    return false;
  }

  const allowedRoot = /^(?:apps|packages|scripts|tools)\//u.test(file);
  const rootConfig = /^[^/]+\.config\.ts$/u.test(file);
  const sourceFile = /\.[cm]?[jt]sx?$/u.test(file);

  return sourceFile && (allowedRoot || rootConfig);
};

export const parseDebtLintOutput = (raw: string): DebtLintResult => {
  try {
    const output = Schema.decodeSync(Schema.fromJsonString(DebtLintOutput))(
      raw
    );

    const entries = output.diagnostics.map((diagnostic) => {
      if (diagnostic.code !== "rat-stack-debt(debt-ledger)") {
        throw new Error(`Unexpected lint rule: ${diagnostic.code}`);
      }

      const [label] = diagnostic.labels;

      if (label === undefined) {
        throw new Error(`Missing source location: ${diagnostic.filename}`);
      }

      const payload = Schema.decodeSync(
        Schema.fromJsonString(DebtDiagnosticPayload)
      )(diagnostic.message);

      return {
        directive: payload.directive,
        file: diagnostic.filename,
        kind: payload.kind,
        line: label.span.line,
        reason: payload.reason,
      };
    });

    return {
      entries: entries.toSorted(
        (left, right) =>
          left.file.localeCompare(right.file) ||
          left.line - right.line ||
          left.directive.localeCompare(right.directive)
      ),
      fileCount: output.number_of_files,
      ruleCount: output.number_of_rules,
    };
  } catch (error) {
    throw buildError("debt lint output", "oxlint JSON", error);
  }
};

const tableCell = (value: string) =>
  value.replaceAll("|", "\\|").replaceAll(/\s+/gu, " ").trim();

export const debtLedgerMarkdown = (entries: readonly DebtEntry[]) => {
  const counts = new Map<string, number>();

  for (const entry of entries) {
    counts.set(entry.kind, (counts.get(entry.kind) ?? 0) + 1);
  }

  const countRows = [...counts]
    .toSorted(([left], [right]) => left.localeCompare(right))
    .map(([kind, count]) => `| ${kind} | ${count} |`);

  const rows = entries.map((entry) => {
    const link = `https://github.com/joelhooks/rat-stack/blob/main/${entry.file}#L${entry.line}`;
    const reason = entry.reason ?? "no reason given";

    return `| [${entry.file}:${entry.line}](${link}) | ${tableCell(entry.directive)} | ${tableCell(reason)} |`;
  });

  return [
    "# Debt ledger",
    "",
    '> "Debt only shrinks."',
    "",
    `Total: **${entries.length}** directives.`,
    "",
    "## Count by directive kind",
    "",
    "| Kind | Count |",
    "| --- | ---: |",
    ...countRows,
    "",
    "The vendored `tools/oxlint/anti-slop/` plugin is excluded. It is Dillon Mulroy's code, not our debt.",
    "",
    "## Every directive",
    "",
    "| File | Directive | Reason |",
    "| --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
};

const linkHrefs = (source: string) => {
  const body = source
    .replaceAll(/```[\s\S]*?```/gu, "")
    .replaceAll(/~~~[\s\S]*?~~~/gu, "")
    .replaceAll(/`[^`\n]+`/gu, "");

  const links = new Set<string>();

  const markdownLink =
    /\]\(\s*(?:<(?<angle>[^>]+)>|(?<plain>[^)\s]+))(?:\s+[^)]*)?\)/gu;

  const referenceLink =
    /^\s*\[[^\]]+\]:\s*(?:<(?<angle>[^>]+)>|(?<plain>\S+))/gmu;

  const htmlAttribute =
    /\b(?:href|src)\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)')/giu;

  const autoLink = /<(?<url>(?:https?:)?\/\/[^>\s]+)>/giu;

  for (const match of body.matchAll(markdownLink)) {
    const href = match.groups?.angle ?? match.groups?.plain;

    if (href !== undefined) {
      links.add(href);
    }
  }

  for (const pattern of [referenceLink, htmlAttribute, autoLink]) {
    for (const match of body.matchAll(pattern)) {
      const href =
        match.groups?.angle ??
        match.groups?.plain ??
        match.groups?.double ??
        match.groups?.single ??
        match.groups?.url;

      if (href !== undefined) {
        links.add(href);
      }
    }
  }

  return [...links];
};

export const internalRouteForLink = (
  href: string,
  pageRoute: string,
  origin = "https://ratstack.sh"
): string | undefined => {
  try {
    const base = new URL(pageRoute, origin);
    const target = new URL(href, base);

    if (target.origin !== base.origin) {
      return undefined;
    }

    return target.pathname.length > 1
      ? target.pathname.replace(/\/$/u, "")
      : target.pathname;
  } catch {
    return undefined;
  }
};

export const validateInternalLinks = (options: {
  readonly knownRoutes: ReadonlySet<string>;
  readonly pageRoute: string;
  readonly sourcePath: string;
  readonly text: string;
}): void => {
  for (const href of linkHrefs(options.text)) {
    const route = internalRouteForLink(href, options.pageRoute);

    if (route !== undefined && !options.knownRoutes.has(route)) {
      throw buildError(
        `internal link ${href}`,
        options.sourcePath,
        new Error(`resolves to unserved route ${route}`)
      );
    }
  }
};

const audienceTag =
  /<(?:AgentOnly|HumanOnly|Diagram|CopyPrompt)(?:\s[^>]*)?>|<\/(?:AgentOnly|HumanOnly|Diagram)>/u;

export interface CopyPromptSpec {
  readonly agentFence: boolean;
  readonly label: string;
  readonly showText: boolean;
  readonly showLabel?: boolean;
  readonly text: string;
}

export const copyPrompts = {
  connect: {
    agentFence: false,
    label: "Copy prompt",
    showLabel: true,
    showText: false,
    text: [
      "Read __RATSTACK_ORIGIN__/llms.txt and use rat-stack as the reference",
      "for how we build: Effect for the hard parts, Alchemy for the",
      "infrastructure, and a fence that makes the easy path the right",
      "one. Search its rules and skills before you write code, follow",
      "its patterns, and tell me when my code breaks them.",
    ].join("\n"),
  },
  cursor: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: '{ "mcpServers": { "rat-stack": { "url": "__RATSTACK_ORIGIN__/mcp" } } }',
  },
  mcp: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: "# Claude Code\nclaude mcp add --transport http rat-stack __RATSTACK_ORIGIN__/mcp\n\n# Codex\ncodex mcp add rat-stack --url __RATSTACK_ORIGIN__/mcp",
  },
  page: {
    agentFence: false,
    label: "Copy a prompt for your agent",
    showText: false,
    text: [
      "Read https://ratstack.sh/tokenmaxx as markdown and https://ratstack.sh/llms.txt.",
      'Explain the "how to burn a trillion tokens and get good results" workshop to me, then help me get ready with the "Before you come" steps.',
      "Do not submit the interest form. Joining the list happens in a browser, because of the human check.",
    ].join("\n"),
  },
  setup: {
    agentFence: true,
    label: "Copy prompt",
    showText: true,
    text: [
      'Check my setup for the "how to burn a trillion tokens and get good results" session.',
      "1. Check that Docker is running (Docker Desktop or OrbStack).",
      "2. Create a private repo from the joelhooks/rat-stack template and clone it: gh repo create my-factory --private --template joelhooks/rat-stack",
      "3. Read https://ratstack.sh/llms.txt",
      "4. Tell me what is missing.",
    ].join("\n"),
  },
  skills: {
    agentFence: false,
    label: "Copy",
    showLabel: true,
    showText: false,
    text: "npx skills add joelhooks/rat-stack",
  },
} satisfies Record<string, CopyPromptSpec>;

const copyPromptTag = /[ \t]*<CopyPrompt id="(?<id>[a-z-]+)"\s*\/>/gu;

const promptSpec = (id: string) => {
  const spec = Object.entries(copyPrompts).find(([key]) => key === id)?.[1];

  if (spec === undefined) {
    throw new Error(`unknown CopyPrompt id ${id}`);
  }

  return spec;
};

const agentBlock =
  /<AgentOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/AgentOnly>/gu;

const humanBlock =
  /<HumanOnly>\s*\r?\n(?<content>[\s\S]*?)\r?\n\s*<\/HumanOnly>/gu;

const diagramBlock =
  /<Diagram\s+alt="(?<alt>[^"]*)">\s*\r?\n(?<fence>```text\r?\n[\s\S]*?\r?\n```)\s*\r?\n<\/Diagram>/gu;

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const bibliographyText = (source: BibliographySource) =>
  `${source.publisher}. ${source.note} Accessed ${source.accessed}.`;

const markdownLabel = (value: string) =>
  value.replaceAll(/[[\]\\*_`<>]/gu, "\\$&");

export const renderBibliography = (sources: readonly BibliographySource[]) => ({
  html:
    sources.length === 0
      ? ""
      : `<section class="bibliography" aria-labelledby="sources"><h2 id="sources">Sources</h2><ol>${sources.map((source) => `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>. ${escapeHtml(bibliographyText(source))}</li>`).join("")}</ol></section>`,
  markdown:
    sources.length === 0
      ? ""
      : `\n\n## Sources\n\n${sources.map((source, index) => `${index + 1}. [${markdownLabel(source.title)}](<${source.url}>)\n   ${markdownLabel(bibliographyText(source))}`).join("\n\n")}\n`,
});

const skippedByBraceEscaper = new Set(["code", "pre"]);

const hasBrace = /[{}]/u;

const braceSafeText = (value: string): LoreHastNode => ({
  type: "raw",
  value: escapeHtml(value).replaceAll("{", "&#123;").replaceAll("}", "&#125;"),
});

export const escapeSvelteBraces = () => (tree: LoreHastNode) => {
  const visit = (node: LoreHastNode): void => {
    if (
      node.children === undefined ||
      skippedByBraceEscaper.has(node.tagName ?? "")
    ) {
      return;
    }

    node.children = node.children.map((child) => {
      if (child.type === "text" && hasBrace.test(child.value ?? "")) {
        return braceSafeText(child.value ?? "");
      }

      visit(child);

      return child;
    });
  };

  visit(tree);
};

export const withMarkdownTitle = (
  source: string,
  title: string,
  bodyHtml: string
): string =>
  /<h1(?:\s|>)/iu.test(bodyHtml)
    ? source
    : `# ${title}\n\n${source.replace(/^---\r?\n[\s\S]*?\r?\n---\s*\r?\n/u, "")}`;

export const assertDocumentTitle = (html: string, sourcePath: string) => {
  const count = [...html.matchAll(/<h1(?:\s|>)/giu)].length;

  if (count !== 1) {
    throw buildError(
      "document title",
      sourcePath,
      new Error(`Expected exactly one H1, found ${count}`)
    );
  }
};

export const deriveAgentMarkdown = (source: string): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withoutHuman = source
    .replaceAll(humanBlock, "")
    .replaceAll(copyPromptTag, (_match: string, id: string) => {
      const spec = promptSpec(id);

      return spec.agentFence ? `\`\`\`text\n${spec.text}\n\`\`\`` : "";
    });

  const withDiagramText = withoutHuman.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) => `${fence}\nDiagram: ${alt}`
  );

  return withDiagramText.replaceAll(agentBlock, "$<content>");
};

export const deriveHtmlMarkdown = (
  source: string,
  renderPrompt: (spec: CopyPromptSpec) => string = () => ""
): string => {
  if (!audienceTag.test(source)) {
    return source;
  }

  const withPrompts = source.replaceAll(
    copyPromptTag,
    (_match: string, id: string) => ` ${renderPrompt(promptSpec(id))}`
  );

  const withDiagrams = withPrompts.replaceAll(
    diagramBlock,
    (_match: string, alt: string, fence: string) =>
      `<figure role="img" aria-label="${escapeHtml(alt)}">\n\n${fence}\n\n<figcaption>${escapeHtml(alt)}</figcaption></figure>`
  );

  const withoutAgent = withDiagrams.replaceAll(agentBlock, "");

  return withoutAgent.replaceAll(humanBlock, "$<content>");
};

export const hasAudienceSyntax = (source: string) => audienceTag.test(source);

interface IcoImage {
  readonly bytes: Uint8Array;
  readonly size: number;
}

export const encodeIco = (images: readonly IcoImage[]): Uint8Array => {
  const headerSize = 6 + images.length * 16;

  const total = images.reduce(
    (length, image) => length + image.bytes.length,
    headerSize
  );

  const ico = new Uint8Array(total);
  const view = new DataView(ico.buffer);
  view.setUint16(2, 1, true);
  view.setUint16(4, images.length, true);
  let offset = headerSize;

  for (const [index, image] of images.entries()) {
    const entry = 6 + index * 16;
    view.setUint8(entry, image.size % 256);
    view.setUint8(entry + 1, image.size % 256);
    view.setUint16(entry + 4, 1, true);
    view.setUint16(entry + 6, 32, true);
    view.setUint32(entry + 8, image.bytes.length, true);
    view.setUint32(entry + 12, offset, true);
    ico.set(image.bytes, offset);
    offset += image.bytes.length;
  }

  return ico;
};
