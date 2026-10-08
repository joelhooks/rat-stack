import { Schema } from "effect";

import { bibliographySourceSchema } from "./component-data.ts";
import type { BibliographySource, CopyPromptSpec } from "./component-data.ts";
import {
  componentContext,
  createComponentRegistry,
  renderComponent,
  renderSvxMarkdown,
} from "./component-registry.ts";
import type { ComponentInput } from "./component-registry.ts";
import { buildError, ContentBuildError } from "./content-error.ts";
import {
  contentHeadings,
  contentLinkHrefs,
  contentRoot,
  countHtmlElements,
  frontmatterData,
  htmlTokens,
  parseContentMarkdown,
  scanLeadingFrontmatterFence,
  stringifyContentMarkdown,
  visitContentNodes,
} from "./svx-ast.ts";

const tierLetters = new Set(["S", "A", "B", "C", "D", "E", "F"]);

const pairedTableHeaders = new Set(["Seen / checked", "XState · bridge"]);

const tierOfCell = (header: string, text: string) =>
  header === "Tier" && tierLetters.has(text) ? text : undefined;

export { buildError, ContentBuildError } from "./content-error.ts";

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

const tableToken = (value: string): ResponsiveTableNode => ({
  children: [{ type: "text", value }],
  properties: { className: ["table-token"] },
  tagName: "span",
  type: "element",
});

const formatTableHeader = (cell: ResponsiveTableNode) => {
  cell.properties = { ...cell.properties, role: "columnheader", scope: "col" };

  if (pairedTableHeaders.has(responsiveTableText(cell).trim())) {
    cell.properties.className = ["table-pair-header"];
  }
};

const formatTableCellTokens = (
  cell: ResponsiveTableNode,
  header: string,
  text: string
) => {
  const pair = pairedTableHeaders.has(header) ? text.split(" · ") : [];

  if (pair.length === 2) {
    cell.properties = { ...cell.properties, className: ["table-pair"] };
    cell.children = pair.map(tableToken);
  } else if (
    header !== "Studied" &&
    /^(?:[@\w./-]+)(?:\s[=≠])?[⁰¹²³⁴⁵⁶⁷⁸⁹]*$/u.test(text)
  ) {
    cell.properties = { ...cell.properties, className: ["table-token"] };
  }

  if (header === "Repo") {
    for (const link of tableChildren(cell, "a")) {
      const [owner, repo, ...rest] = responsiveTableText(link).split("/");

      if (
        owner !== undefined &&
        owner !== "" &&
        repo !== undefined &&
        repo !== "" &&
        rest.length === 0
      ) {
        link.children = [
          tableToken(`${owner}/`),
          { children: [], properties: {}, tagName: "wbr", type: "element" },
          tableToken(repo),
        ];
      }
    }
  }
};

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
            formatTableHeader(cell);
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

            formatTableCellTokens(cell, header, text);

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

export type { BibliographySource } from "./component-data.ts";

export interface LorePageMetadata {
  readonly bibliography: readonly BibliographySource[];
  readonly card?: string;
  readonly prerequisites: readonly string[];
  readonly date?: string;
  readonly description: string;
  readonly diagram?: string;
  readonly learn?: boolean;
  readonly plain?: string;
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
  card: Schema.optional(Schema.String),
  date: Schema.optional(Schema.String),
  description: Schema.String,
  diagram: Schema.optional(Schema.String),
  group: Schema.Literals(["idea", "concept", "source", "person", "system"]),
  learn: Schema.optional(Schema.Boolean),
  plain: Schema.optional(Schema.String),
  prerequisites: Schema.optional(Schema.Array(Schema.String)),
  sources: Schema.Array(
    Schema.Union([Schema.String, bibliographySourceSchema])
  ),
  speaker: Schema.optional(Schema.String),
  terms: Schema.optional(Schema.Array(Schema.String)),
  title: Schema.String,
  url: Schema.optional(Schema.String),
});

export const frontmatterTerms = (rawText: string, sourcePath: string) =>
  Schema.decodeUnknownSync(Schema.Array(Schema.String))(
    frontmatterData(rawText, sourcePath).terms ?? []
  );

export const frontmatterValue = (rawText: string, field: string) =>
  Schema.decodeUnknownSync(Schema.String)(frontmatterData(rawText)[field]);

type LoreFrontmatter = typeof loreFrontmatterSchema.Type;

type MutableLorePageMetadata = {
  -readonly [Key in keyof LorePageMetadata]: LorePageMetadata[Key];
};

const decodeLoreFrontmatter = (
  sourcePath: string,
  rawText: string
): LoreFrontmatter => {
  try {
    const data = frontmatterData(rawText, sourcePath);

    const sources = Schema.decodeUnknownSync(
      Schema.Array(Schema.Union([Schema.String, bibliographySourceSchema])),
      { onExcessProperty: "error" }
    )(data.sources);

    return Schema.decodeUnknownSync(loreFrontmatterSchema)({
      ...data,
      sources,
    });
  } catch (error) {
    if (Schema.is(ContentBuildError)(error)) {
      throw error;
    }

    throw buildError(
      "frontmatter",
      sourcePath,
      new Error(
        "Repair the frontmatter schema. Linked sources require url, title, publisher, note, and accessed. Recorded sources require kind: recording, title, recordedAt (YYYY-MM-DD), and note, with no url.",
        { cause: error }
      )
    );
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

  const headings = new Set(contentHeadings(rawText, 2));

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
    ...decoded.sources.flatMap((entry) => {
      if (Schema.is(Schema.String)(entry)) {
        return [entry];
      }

      return entry.kind === "recording" ? [] : [entry.url];
    }),
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

  if (scanLeadingFrontmatterFence(rawText, sourcePath).yaml === undefined) {
    throw buildError(
      "frontmatter",
      sourcePath,
      new Error("missing YAML frontmatter")
    );
  }

  const decoded = decodeLoreFrontmatter(sourcePath, rawText);
  validateLoreDescription(sourcePath, decoded);

  const terms = validateLoreTerms(sourcePath, decoded);

  validateLoreGroup(sourcePath, decoded);
  validateSystemPlacement(sourcePath, decoded, rawText);
  validateLoreSources(sourcePath, decoded);

  const bibliography = decoded.sources.map((source) => {
    if (!Schema.is(Schema.String)(source) && source.kind === "recording") {
      if (
        [source.title, source.note].some(
          (value) => value.trim() === "" || /[\r\n]/u.test(value)
        ) ||
        /https?:\/\//u.test(source.title)
      ) {
        throw buildError(
          "bibliography",
          sourcePath,
          new Error(
            "recording sources require a plain title, note, and ISO recordedAt date"
          )
        );
      }

      return source;
    }

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
    card: decoded.card ?? decoded.description,
    description: decoded.description,
    group: decoded.group,
    prerequisites: decoded.prerequisites ?? [],
    routePath:
      decoded.group === "system" ? `/systems/${slug}` : `/lore/${slug}`,
    slug,
    sourcePath,
    sources: bibliography.flatMap((source) =>
      source.kind === "linked" ? [source.url] : []
    ),
    terms,
    title: decoded.title,
  };

  if (decoded.date !== undefined) {
    metadata.date = decoded.date;
  }

  if (decoded.speaker !== undefined) {
    metadata.speaker = decoded.speaker;
  }

  if (decoded.plain !== undefined) {
    metadata.plain = decoded.plain;
  }

  if (decoded.diagram !== undefined) {
    metadata.diagram = decoded.diagram;
  }

  if (decoded.learn !== undefined) {
    metadata.learn = decoded.learn;
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
  readonly description: string;
  readonly routePath: string;
}

const glossaryDefinitions: readonly GlossaryEntry[] = [
  {
    routePath: "/lore/effect-basics",
    summary:
      "A TypeScript library for describing work with typed failures and required services. A runtime executes the description.",
    term: "Effect",
  },
  {
    routePath: "/lore/effect-basics",
    summary:
      "A service that a description of work still needs before it can run.",
    term: "requirement",
  },
  {
    routePath: "/lore/effect-basics",
    summary:
      "An unexpected execution failure, separate from the failures that callers are expected to handle.",
    term: "defect",
  },
  {
    routePath: "/lore/schemas-define-the-boundary",
    summary:
      "A description of accepted values, their TypeScript types, and the rules for checking and converting them at runtime.",
    term: "Schema",
  },
  {
    routePath: "/lore/services-capture-dependencies",
    summary:
      "A named interface for one job. Callers request it by its identifier, and startup code supplies its implementation.",
    term: "service",
  },
  {
    routePath: "/lore/services-capture-dependencies",
    summary:
      "The identifier used to request a service, a named interface for one job, from Effect's collection of available implementations.",
    term: "service tag",
  },
  {
    routePath: "/lore/layers-make-dependencies-explicit",
    summary:
      "A description of how to build service implementations and supply what their construction needs.",
    term: "Layer",
  },
  {
    routePath: "/lore/layers-make-dependencies-explicit",
    summary:
      "Sharing a constructed service within one build context by the identity of the Layer that builds it.",
    term: "Layer memoization",
  },
  {
    routePath: "/lore/layers-make-dependencies-explicit",
    summary:
      "Reusing a previously constructed result within a stated context. Service construction shares results by Layer identity within one build context.",
    term: "memoization",
  },
  {
    routePath: "/systems/capabilities",
    summary:
      "The shared name, input, output, failure, and metadata for an action. It contains no server-side implementation.",
    term: "contract",
  },
  {
    routePath: "/systems/capabilities",
    summary:
      "One named action with a contract describing its accepted values and a server-side implementation that performs the work.",
    term: "capability",
  },
  {
    routePath: "/systems/capabilities",
    summary:
      "The server-side implementation called after input validation and any required approval.",
    term: "handler",
  },
  {
    routePath: "/lore/one-capability-every-surface",
    summary:
      "Code that turns a named action and its shared definition into a command, HTTP API, MCP tool, RPC interface, or code-mode interface.",
    term: "projection",
  },
  {
    routePath: "/lore/one-capability-every-surface",
    summary:
      "Code that exposes a named action through a particular interface without adding separate business behavior.",
    term: "capability projection",
  },
  {
    routePath: "/lore/one-schema-three-surfaces",
    summary:
      "A way to call a named action, such as the command line or HTTP API.",
    term: "interface",
  },
  {
    routePath: "/lore/one-schema-three-surfaces",
    summary:
      "In the motto “one capability, every surface”, a way to call a named action. Other prose uses “interface”.",
    term: "surface",
  },
  {
    routePath: "/lore/cartridges",
    summary:
      "A package for one job that includes its implementation and needed infrastructure. It must pass the project's add-and-remove test.",
    term: "cartridge",
  },
  {
    routePath: "/lore/cartridges",
    summary:
      "Add one package and one provision line, then remove them without breaking unrelated packages. The package owns its resources and connections.",
    term: "cartridge test",
  },
  {
    routePath: "/lore/the-fence",
    summary:
      "Compiler checks, lint rules, and hooks that reject prohibited code and shortcuts. They do not prove every runtime behavior.",
    term: "fence",
  },
  {
    routePath: "/skills/learn-alchemy",
    summary:
      "An infrastructure tool built with Effect. Its program declares cloud resources and can produce a plan before applying changes.",
    term: "Alchemy",
  },
  {
    routePath: "/skills/learn-alchemy",
    summary:
      "One program that declares infrastructure and returns its outputs.",
    term: "Alchemy Stack",
  },
  {
    routePath: "/lore/bindings",
    summary:
      "A declared connection that gives a Cloudflare Worker a typed runtime value or access to a resource.",
    term: "binding",
  },
  {
    routePath: "/lore/mcp-is-another-surface",
    summary:
      "Model Context Protocol: a protocol through which an agent client discovers and calls tools.",
    term: "MCP",
  },
  {
    routePath: "/skills/learn-rat-stack",
    summary:
      "Remote procedure call: a client calls a named operation implemented on the server.",
    term: "RPC",
  },
  {
    routePath: "/lore/one-program-can-replace-several-tool-calls",
    summary:
      "Running one program that combines calls to declared actions inside a restricted environment.",
    term: "code mode",
  },
  {
    routePath: "/systems/agent-front-door",
    summary:
      "Agent2Agent protocol. This site's implementation answers documentation questions through search and read.",
    term: "A2A",
  },
  {
    routePath: "/systems/agent-front-door",
    summary:
      "The discovery documents and callable HTTP, MCP, A2A, and code-mode endpoints hosted by this site.",
    term: "agent interfaces",
  },
  {
    routePath: "/lore/hexagonal-architecture",
    summary:
      "An application-owned interface named for the job the application needs.",
    term: "port",
  },
  {
    routePath: "/lore/hexagonal-architecture",
    summary:
      "An implementation that connects an application-owned interface to a particular external technology or provider.",
    term: "adapter",
  },
  {
    routePath: "/lore/structure-effect-by-domain",
    summary:
      "Startup code that chooses and supplies the application's service implementations.",
    term: "composition root",
  },
  {
    routePath: "/lore/context-and-requirements",
    summary: "The collection of services supplied to running work in Effect.",
    term: "context",
  },
  {
    routePath: "/lore/error-model",
    summary:
      "A declared failure carried in an Effect description's E type parameter. Callers can handle it.",
    term: "expected failure",
  },
  {
    routePath: "/lore/lifecycles-are-machines",
    summary:
      "A running unit that processes events or performs work for a state machine. Declared Effect actors perform this repo's side effects.",
    term: "actor",
  },
  {
    routePath: "/lore/lifecycles-are-machines",
    summary: "Named states and the events that permit movement between them.",
    term: "state machine",
  },
  {
    routePath: "/lore/lifecycles-are-machines",
    summary:
      "A definition of named states and the events that permit movement between them.",
    term: "machine",
  },
  {
    routePath: "/lore/concurrent-work-needs-an-owner",
    summary:
      "Independently running work in Effect. Its fork operation determines its lifetime and ownership.",
    term: "fiber",
  },
  {
    routePath: "/lore/concurrent-work-needs-an-owner",
    summary:
      "Independently running work owned by a cleanup scope. Closing that scope interrupts the work.",
    term: "scoped fiber",
  },
  {
    routePath: "/lore/concurrent-work-needs-an-owner",
    summary:
      "The number of collection items whose work can run at the same time.",
    term: "traversal concurrency",
  },
  {
    routePath: "/lore/concurrent-work-needs-an-owner",
    summary:
      "A consumer's demand limits how quickly its producer can progress. An unbounded queue can break that constraint.",
    term: "backpressure",
  },
  {
    routePath: "/lore/concurrent-work-needs-an-owner",
    summary:
      "A stream consumer requests data as it can process it, limiting the producer's progress.",
    term: "stream backpressure",
  },
  {
    routePath: "/lore/scopes-own-resources",
    summary:
      "An owner for registered cleanup operations. Closing it runs those operations.",
    term: "Scope",
  },
  {
    routePath: "/lore/scopes-own-resources",
    summary:
      "A cleanup operation registered with an owner or an acquire-use-release operation.",
    term: "resource finalizer",
  },
  {
    routePath: "/lore/configuration-is-a-dependency",
    summary:
      "A description of how to build a service containing validated configuration values.",
    term: "configuration Layer",
  },
  {
    routePath: "/lore/configuration-is-a-dependency",
    summary:
      "The source of raw configuration inputs that Effect reads and validates.",
    term: "ConfigProvider",
  },
  {
    routePath: "/lore/run-effect-at-the-boundary",
    summary:
      "The place where code outside Effect needs to execute a description of work.",
    term: "runtime boundary",
  },
  {
    routePath: "/lore/run-effect-at-the-boundary",
    summary:
      "A runtime that retains constructed services between calls until it is disposed.",
    term: "managed runtime",
  },
  {
    routePath: "/lore/http-responses-need-validation",
    summary:
      "Repeating an operation creates no additional change beyond its first successful application.",
    term: "idempotency",
  },
  {
    routePath: "/lore/trace-meaningful-operations",
    summary:
      "Understanding a running system through logs, metrics, and traces.",
    term: "observability",
  },
  {
    routePath: "/lore/trace-meaningful-operations",
    summary:
      "The logs, measurements, and trace data recorded about a running system.",
    term: "telemetry",
  },
  {
    routePath: "/lore/trace-meaningful-operations",
    summary: "A record of an operation's timing and outcome.",
    term: "trace span",
  },
  {
    routePath: "/lore/trace-meaningful-operations",
    summary: "A record of an operation's timing and outcome.",
    term: "tracing span",
  },
  {
    routePath: "/lore/trace-meaningful-operations",
    summary:
      "Sending recorded trace data to a collector. Sending, acceptance, and stored retrieval are separate observations.",
    term: "trace export",
  },
  {
    routePath: "/skills/add-a-store",
    summary:
      "The authoritative store for a fact. Derived copies can be rebuilt from it.",
    term: "system of record",
  },
  {
    routePath: "/skills/add-a-store",
    summary:
      "Derived data arranged for efficient reads. It does not become the authority for writes.",
    term: "read model",
  },
  {
    routePath: "/lore/code-snippets",
    summary:
      "A code block delimited by backticks. Its opening line can carry a language and excerpt options.",
    term: "Markdown code fence",
  },
  {
    routePath: "/lore/code-snippets",
    summary:
      "Options on the opening line of a Markdown code block. These options are separate from the project's enforcement checks.",
    term: "fence metadata",
  },
  {
    routePath: "/lore/code-snippets",
    summary:
      "The repository, commit, file, and original lines from which an excerpt comes.",
    term: "provenance",
  },
  {
    routePath: "/lore/build-time-work-stays-out-of-requests",
    summary: "Generated output identified by a hash of its content.",
    term: "content-addressed output",
  },
  {
    routePath: "/skills/gardener",
    summary: "An exact dependency version or source revision.",
    term: "pin",
  },
  {
    routePath: "/lore/pinned-sources-can-report-drift",
    summary:
      "A difference between selected pinned lines and the current source. It does not replace the pinned text.",
    term: "source drift",
  },
  {
    routePath: "/lore/engine-neutral-tokens-keep-adapters-replaceable",
    summary:
      "A segment of source text with a syntax role and font style, independent of Shiki's types.",
    term: "engine-neutral token",
  },
  {
    routePath: "/lore/engine-neutral-tokens-keep-adapters-replaceable",
    summary:
      "An interface for turning source code into per-line syntax tokens.",
    term: "highlighter port",
  },
  {
    routePath: "/lore/accumulate-independent-errors",
    summary:
      "Collecting independent failures so one result reports all of them before generated files are written.",
    term: "error accumulation",
  },
  {
    routePath: "/lore/there-is-no-isr-on-cloudflare",
    summary:
      "Incremental static regeneration: rebuilding a cached page after its revalidation interval while serving a previously generated page.",
    term: "ISR",
  },
  {
    routePath: "/lore/there-is-no-isr-on-cloudflare",
    summary:
      "Cloudflare's programmable cache for HTTP responses. Each location holds its own cached responses.",
    term: "Workers Cache",
  },
  {
    routePath: "/lore/tests-that-earn-their-place",
    summary:
      "Tests whose expected answers repeat the implementation instead of stating an independent rule.",
    term: "tautological tests",
  },
  {
    routePath: "/lore/no-comments",
    summary:
      "Prose comments are banned. Explained tool directives, safety assertions, and type-only JavaScript JSDoc have stated exceptions.",
    term: "no comments",
  },
  {
    routePath: "/skills/uncomplect",
    summary: "Separate concerns that currently change together.",
    term: "uncomplect",
  },
  {
    routePath: "/skills/uncomplect",
    summary:
      "A thin browser route and view that reads client state and calls named client commands.",
    term: "feature",
  },
  {
    routePath: "/skills/uncomplect",
    summary:
      "Browser code that owns queries, named commands, and the local copy of server state.",
    term: "client",
  },
];

export const glossaryEntries = (
  pages: readonly GlossaryPage[],
  definitions: readonly GlossaryEntry[] = glossaryDefinitions
): readonly GlossaryEntry[] => {
  const entries = new Map<string, GlossaryEntry>();

  for (const entry of definitions) {
    const key = entry.term.trim().toLowerCase();

    const page = pages.find(
      (candidate) => candidate.routePath === entry.routePath
    );

    if (key === "" || entry.summary.trim() === "") {
      throw buildError(
        "glossary definition",
        entry.term,
        new Error("Declare a term and its own nonempty definition.")
      );
    }

    if (page === undefined) {
      throw buildError(
        "glossary definition",
        entry.term,
        new Error(`Missing teaching page: ${entry.routePath}`)
      );
    }

    if (entry.summary.trim() === page.description.trim()) {
      throw buildError(
        "glossary definition",
        entry.term,
        new Error(
          "Write a term definition instead of copying the page summary."
        )
      );
    }

    if (entries.has(key)) {
      throw buildError(
        "glossary definition",
        entry.term,
        new Error("Declare each glossary term only once.")
      );
    }

    entries.set(key, entry);
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

export interface LoreHastNode {
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
  const targets = new Set<string>();

  for (const href of contentLinkHrefs(
    markdown.replaceAll("__RATSTACK_ORIGIN__", "https://ratstack.sh"),
    false
  )) {
    const target = new URL(href, "https://ratstack.sh");

    if (
      target.origin !== "https://ratstack.sh" ||
      !(
        target.pathname.startsWith("/lore/") ||
        target.pathname.startsWith("/systems/")
      )
    ) {
      continue;
    }

    const route = target.pathname.endsWith("/")
      ? target.pathname.slice(0, -1)
      : target.pathname;

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

const linkHrefs = contentLinkHrefs;

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

export { copyPrompts } from "./component-data.ts";

export type { CopyPromptSpec } from "./component-data.ts";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

export const renderBibliography = (sources: readonly BibliographySource[]) => {
  const registry = createComponentRegistry();
  const context = componentContext({ sources });

  const input = {
    attributes: {},
    children: contentRoot([]),
    name: "Sources",
    placement: "block",
  } satisfies ComponentInput;

  return {
    html: stringifyContentMarkdown(
      contentRoot(renderComponent(registry, "human", input, context))
    ).trim(),
    markdown:
      sources.length === 0
        ? ""
        : `\n\n${stringifyContentMarkdown(
            contentRoot(renderComponent(registry, "agent", input, context))
          )}`,
  };
};

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
  countHtmlElements(bodyHtml, "h1") > 0
    ? source
    : `# ${title}\n\n${scanLeadingFrontmatterFence(source, title).body.trimStart()}`;

export const assertDocumentTitle = (html: string, sourcePath: string) => {
  const count = countHtmlElements(html, "h1");

  if (count !== 1) {
    throw buildError(
      "document title",
      sourcePath,
      new Error(`Expected exactly one H1, found ${count}`)
    );
  }
};

export const deriveAgentMarkdown = (
  source: string,
  registry = createComponentRegistry()
): string => renderSvxMarkdown(source, "agent", {}, registry);

export const deriveHtmlMarkdown = (
  source: string,
  renderPrompt: (spec: CopyPromptSpec) => string = () => "",
  registry = createComponentRegistry()
): string =>
  renderSvxMarkdown(
    source,
    "human",
    { renderCopyPrompt: renderPrompt },
    registry
  );

export const hasAudienceSyntax = (source: string) => {
  let found = false;
  visitContentNodes(parseContentMarkdown(source), (node) => {
    if (
      node.type === "html" &&
      htmlTokens(node.value).some(
        (token) => token.name.charAt(0) >= "A" && token.name.charAt(0) <= "Z"
      )
    ) {
      found = true;
    }
  });

  return found;
};

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
