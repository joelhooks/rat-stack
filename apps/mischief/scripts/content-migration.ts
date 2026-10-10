import { encodeDocument } from "@foldkit/markdown";
import { parseMarkdown } from "@foldkit/markdown/vite";
import { Effect, Result, Schema } from "effect";
import type { Nodes } from "mdast";

import { componentContext, renderSvxMarkdown } from "./component-registry.ts";
import type { ComponentRegistry } from "./component-registry.ts";
import { internalRouteForLink, loreFrontmatterSchema } from "./content-lib.ts";
import { documentMarkdown } from "./migration-document.ts";
import type { ListLayout } from "./migration-document.ts";
import { migrationIslands } from "./migration-islands.ts";
import type { HtmlToken } from "./svx-ast.ts";
import {
  frontmatterData,
  htmlTokens,
  parseContentMarkdown,
  scanLeadingFrontmatterFence,
  visitContentNodes,
} from "./svx-ast.ts";

export class ContentMigrationIssue extends Schema.TaggedError<ContentMigrationIssue>()(
  "ContentMigrationIssue",
  {
    construct: Schema.String,
    line: Schema.Finite,
    repair: Schema.String,
    sourcePath: Schema.String,
  }
) {}

export const MigrationFrontmatter = Schema.Struct({
  prerequisites: loreFrontmatterSchema.fields.prerequisites,
  sources: Schema.optionalKey(loreFrontmatterSchema.fields.sources),
  terms: loreFrontmatterSchema.fields.terms,
});

const decodeNestedFrontmatter = Schema.decodeUnknownSync(MigrationFrontmatter);

export const migrationLinkFailures = (
  source: string,
  sourcePath: string,
  knownRoutes: ReadonlySet<string>
) => {
  const failures: ContentMigrationIssue[] = [];

  visitContentNodes(parseContentMarkdown(source, sourcePath), (node) => {
    if (node.type !== "link") {
      return;
    }

    const route = internalRouteForLink(node.url, "/");

    if (
      route !== undefined &&
      /^\/(?:lore|systems)\//u.test(route) &&
      !knownRoutes.has(route)
    ) {
      failures.push(
        new ContentMigrationIssue({
          construct: "internal lore link",
          line: node.position?.start.line ?? 1,
          repair: `Repair ${node.url}; ${route} is absent from the source graph.`,
          sourcePath,
        })
      );
    }
  });

  return failures;
};

interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly value: string;
}

const islandAttributeValue = (value: string) =>
  `"${value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("\n", "&#10;").replaceAll("\r", "&#13;")}"`;

const hasInlineNeighbours = (source: string, start: number, end: number) => {
  const prefix = source.slice(source.lastIndexOf("\n", start - 1) + 1, start);

  const suffix = source.slice(
    end,
    source.includes("\n", end) ? source.indexOf("\n", end) : source.length
  );

  return prefix.trim() !== "" || suffix.trim() !== "";
};

const maximumIslandNesting = (tokens: readonly HtmlToken[]) => {
  const nesting = { depth: 0, maximum: 0 };

  for (const token of tokens) {
    if (Object.hasOwn(migrationIslands, token.name) && !token.selfClosing) {
      nesting.depth += token.kind === "open" ? 1 : -1;
      nesting.maximum = Math.max(nesting.maximum, nesting.depth);
    }
  }

  return nesting.maximum;
};

export const mapMigrationSource = (source: string, sourcePath: string) => {
  const failures: ContentMigrationIssue[] = [];
  const replacements: Replacement[] = [];
  const lists: ListLayout[] = [];
  const components: string[] = [];

  const fragments: {
    readonly value: string;
    readonly start: number;
    readonly line: number;
  }[] = [];

  const leading = scanLeadingFrontmatterFence(source, sourcePath);
  const root = parseContentMarkdown(source, sourcePath);

  const issue = (node: Nodes, construct: string, repair: string) =>
    failures.push(
      new ContentMigrationIssue({
        construct,
        line: node.position?.start.line ?? 1,
        repair,
        sourcePath,
      })
    );

  visitContentNodes(root, (node) => {
    if (node.type === "html") {
      fragments.push({
        line: node.position?.start.line ?? 1,
        start: node.position?.start.offset ?? 0,
        value: node.value,
      });
    }

    if (node.type === "list") {
      lists.push({
        items: node.children.map((item) => item.spread),
        spread: node.spread,
      });
    }

    if (
      node.type === "listItem" &&
      node.checked !== null &&
      node.checked !== undefined
    ) {
      issue(
        node,
        "task list",
        "Hand-map task state to an approved island; Foldkit has no task-list node."
      );
    }

    if (
      [
        "definition",
        "linkReference",
        "imageReference",
        "footnoteDefinition",
        "footnoteReference",
      ].includes(node.type)
    ) {
      issue(
        node,
        node.type,
        "Expand this reference explicitly before migration; Foldkit does not support it."
      );
    }

    if (
      node.type === "text" &&
      node.value.includes(":") &&
      !/^(?:https?:|mailto:)/u.test(node.value)
    ) {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;

      if (start !== undefined && end !== undefined) {
        replacements.push({
          end,
          start,
          value: source
            .slice(start, end)
            .replaceAll(/(?<!\\):(?=[\w])/gu, "\\:"),
        });
      }
    }

    if (
      node.type === "text" &&
      /\{(?!#[a-zA-Z][\w-]*\})[^}\n]+\}/u.test(node.value)
    ) {
      issue(
        node,
        "Svelte expression",
        "Replace the expression with sourced Markdown or an approved typed island."
      );
    }
  });

  const html = fragments.map((fragment) => fragment.value).join("");

  const positions: {
    readonly start: number;
    readonly end: number;
    readonly sourceStart: number;
  }[] = [];

  let offset = 0;

  for (const fragment of fragments) {
    positions.push({
      end: offset + fragment.value.length,
      sourceStart: fragment.start,
      start: offset,
    });
    offset += fragment.value.length;
  }

  const sourceOffset = (value: number, end: boolean) => {
    const position = positions.find((entry) =>
      end
        ? value > entry.start && value <= entry.end
        : value >= entry.start && value < entry.end
    );

    return position === undefined
      ? 0
      : position.sourceStart + value - position.start;
  };

  const pending: string[] = [];
  const tokens = htmlTokens(html);
  const maximumNesting = maximumIslandNesting(tokens);

  if (fragments.length > 0 && tokens.length === 0) {
    failures.push(
      new ContentMigrationIssue({
        construct: "raw HTML",
        line: fragments[0]?.line ?? 1,
        repair:
          "Remove or hand-map HTML comments and declarations; no content is dropped automatically.",
        sourcePath,
      })
    );
  }

  for (const token of tokens) {
    const start = sourceOffset(token.start, false);
    const end = sourceOffset(token.end, true);
    const line = source.slice(0, start).split("\n").length;

    const fail = (construct: string, repair: string) =>
      failures.push(
        new ContentMigrationIssue({ construct, line, repair, sourcePath })
      );

    const definition = Object.entries(migrationIslands).find(
      ([name]) => name === token.name
    )?.[1];

    if (definition === undefined) {
      fail(
        token.name === "script"
          ? "script"
          : `raw HTML or unknown component <${token.name}>`,
        "Hand-map the complete construct to an approved typed island; scripts and arbitrary HTML are not migrated."
      );
      continue;
    }

    if (hasInlineNeighbours(source, start, end)) {
      fail(
        `inline ${token.name}`,
        "Put this island on its own line; Foldkit supports block islands only."
      );
    }

    if (token.kind === "close") {
      const opening = pending.pop();

      if (opening !== token.name) {
        fail(
          `unmatched ${token.name}`,
          "Repair the component nesting before migration."
        );
      }

      replacements.push({
        end,
        start,
        value: ":".repeat(2 + maximumNesting - pending.length),
      });
      continue;
    }

    components.push(token.name);

    if (
      Object.keys(token.attributes).some(
        (name) => !token.quotedAttributes.includes(name)
      )
    ) {
      fail(
        `attributes of ${token.name}`,
        "Use quoted string attributes, never Svelte expressions."
      );
    }

    try {
      Schema.decodeUnknownSync(definition, { onExcessProperty: "error" })(
        token.attributes
      );
    } catch {
      fail(
        `attributes of ${token.name}`,
        "Match the attribute Schema in migration-islands.ts."
      );
    }

    const attributes = Object.entries(token.attributes)
      .map(([name, value]) => `${name}=${islandAttributeValue(value)}`)
      .join(" ");

    const prefix = token.selfClosing
      ? "::"
      : ":".repeat(2 + maximumNesting - pending.length);

    replacements.push({
      end,
      start,
      value: `${prefix}${token.name}${attributes === "" ? "" : `{${attributes}}`}`,
    });

    if (!token.selfClosing) {
      pending.push(token.name);
    }
  }

  for (const name of pending) {
    failures.push(
      new ContentMigrationIssue({
        construct: `unclosed ${name}`,
        line: 1,
        repair: "Close every component before migration.",
        sourcePath,
      })
    );
  }

  let candidate = source;

  for (const replacement of replacements.toSorted(
    (left, right) => right.start - left.start
  )) {
    candidate =
      candidate.slice(0, replacement.start) +
      replacement.value +
      candidate.slice(replacement.end);
  }

  return { candidate, components, failures, leading, lists };
};

export const migrateContentSource = Effect.fn("migrateContentSource")(
  function* migrateContentSource(
    source: string,
    sourcePath: string,
    registry: ComponentRegistry
  ) {
    const mapped = yield* Effect.try({
      catch: () =>
        new ContentMigrationIssue({
          construct: "source parse",
          line: 1,
          repair: "Repair YAML and Markdown syntax before migration.",
          sourcePath,
        }),
      try: () => mapMigrationSource(source, sourcePath),
    });

    const failures = [...mapped.failures];

    if (failures.length > 0) {
      return {
        candidate: mapped.candidate,
        components: mapped.components,
        failures,
        roundTrip: undefined,
        sourcePath,
      };
    }

    const result = yield* Effect.try({
      catch: (cause) =>
        new ContentMigrationIssue({
          construct: "Document compilation or rendering",
          line: 1,
          repair: String(cause),
          sourcePath,
        }),
      try: () => {
        const frontmatter = frontmatterData(source, sourcePath);
        const nested = decodeNestedFrontmatter(frontmatter);

        const { body } = scanLeadingFrontmatterFence(
          mapped.candidate,
          sourcePath
        );

        const document = parseMarkdown(body, { islands: migrationIslands });

        const context = componentContext({
          sourcePath,
          sources: (nested.sources ?? []).flatMap((entry) =>
            Schema.is(Schema.String)(entry) ? [] : [entry]
          ),
        });

        const newBody = documentMarkdown(
          document,
          registry,
          context,
          mapped.lists
        );

        const prefix =
          mapped.leading.yaml === undefined
            ? ""
            : `---\n${mapped.leading.yaml.value}\n---\n\n`;

        const before = renderSvxMarkdown(source, "agent", context, registry);
        const after = `${prefix}${newBody}`;

        return {
          after,
          before,
          document: encodeDocument(document),
          frontmatter,
          lists: mapped.lists,
        };
      },
    }).pipe(Effect.result);

    if (Result.isFailure(result)) {
      failures.push(result.failure);

      return {
        candidate: mapped.candidate,
        components: mapped.components,
        failures,
        roundTrip: undefined,
        sourcePath,
      };
    }

    return {
      candidate: mapped.candidate,
      components: mapped.components,
      failures,
      roundTrip: result.success,
      sourcePath,
    };
  }
);
