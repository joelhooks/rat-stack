import { codeIdentity } from "@rat-stack/code-snippets";
import { Predicate, Schema } from "effect";
import type { Nodes, Root, RootContent } from "mdast";

import { bibliographySourceSchema, copyPrompts } from "./component-data.ts";
import type { BibliographySource, CopyPromptSpec } from "./component-data.ts";
import { buildError } from "./content-error.ts";
import {
  contentRoot,
  frontmatterData,
  htmlTokens,
  parseContentMarkdown,
  stringifyContentMarkdown,
  visitContentNodes,
} from "./svx-ast.ts";

const promptForVariant = (
  prompt: CopyPromptSpec,
  variant: "primary" | "text" | undefined
): CopyPromptSpec => {
  if (variant === "primary") {
    return { ...prompt, label: "Copy prompt", variant };
  }

  if (variant === "text") {
    return { ...prompt, showText: true, variant };
  }

  return prompt;
};

export interface ComponentInput {
  readonly attributes: Readonly<Record<string, string>>;
  readonly children: Root;
  readonly name: string;
  readonly placement: "block" | "inline";
}

export interface ComponentRenderContext {
  readonly origin: string;
  readonly pagePath: string;
  readonly renderCopyPrompt: (spec: CopyPromptSpec) => string;
  readonly sourcePath: string;
  readonly sources: readonly BibliographySource[];
}

export interface ComponentDefinition {
  readonly agent: (
    input: ComponentInput,
    context: ComponentRenderContext
  ) => readonly RootContent[];
  readonly human: (
    input: ComponentInput,
    context: ComponentRenderContext
  ) => readonly RootContent[];
}

export type ComponentRegistry = Readonly<Record<string, ComponentDefinition>>;

export type ComponentTarget = "agent" | "human";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const html = (value: string): RootContent => ({ type: "html", value });

const paragraph = (value: string): RootContent => ({
  children: [{ type: "text", value }],
  type: "paragraph",
});

export const agentPointerText =
  "For agents: start with the agent guide. Every page is Markdown by default; add Accept: text/html for HTML.";

export const agentPointerHtml =
  'For agents: start with the <a href="https://ratstack.sh/llms.txt">agent guide</a>. Every page is Markdown by default; add <code>Accept: text/html</code> for HTML.';

const pointerAgent = (): readonly RootContent[] => [
  {
    children: [
      {
        children: [
          { type: "text", value: "For agents: start with the " },
          {
            children: [{ type: "text", value: "agent guide" }],
            type: "link",
            url: "https://ratstack.sh/llms.txt",
          },
          { type: "text", value: ". Every page is Markdown by default; add " },
          { type: "inlineCode", value: "Accept: text/html" },
          { type: "text", value: " for HTML." },
        ],
        type: "paragraph",
      },
    ],
    type: "blockquote",
  },
];

const configuredCodeNode = (node: {
  readonly lang?: string | null | undefined;
  readonly meta?: string | null | undefined;
}) =>
  (node.meta ?? "") !== "" ||
  (node.lang ?? "").includes("=") ||
  (node.lang ?? "").startsWith("{");

const codeFenceInput = (node: Nodes): ComponentInput | undefined =>
  node.type === "code" && configuredCodeNode(node)
    ? {
        attributes: { key: codeIdentity(node) },
        children: contentRoot([]),
        name: "Code",
        placement: "block",
      }
    : undefined;

const componentChildren = (input: ComponentInput): readonly RootContent[] =>
  input.placement === "inline"
    ? input.children.children.flatMap((node) =>
        node.type === "paragraph" ? node.children : [node]
      )
    : input.children.children;

const phrasingTypes = new Set([
  "text",
  "inlineCode",
  "html",
  "link",
  "image",
  "linkReference",
  "imageReference",
  "emphasis",
  "strong",
  "delete",
  "break",
  "footnoteReference",
]);

const coreComponents = {
  AgentOnly: {
    agent: componentChildren,
    human: () => [],
  },
  AgentPointer: {
    agent: pointerAgent,
    human: () => [
      html(
        `<p class="agent-pointer visually-hidden" aria-hidden="true">${agentPointerHtml}</p>`
      ),
    ],
  },
  CopyPrompt: {
    agent(input) {
      const { id, variant } = Schema.decodeUnknownSync(
        Schema.Struct({
          audience: Schema.optional(Schema.Literal("agent")),
          id: Schema.String,
          variant: Schema.optional(Schema.Literals(["primary", "text"])),
        })
      )(input.attributes);

      const prompt = Object.entries(copyPrompts).find(
        ([key]) => key === id
      )?.[1];

      if (prompt === undefined) {
        throw buildError("CopyPrompt", id, new Error("Unknown prompt id"));
      }

      if (variant === "primary") {
        return [
          {
            children: [
              {
                children: [{ type: "text", value: "Apply through your agent" }],
                type: "link",
                url: "#apply-through-your-agent",
              },
            ],
            type: "paragraph",
          },
        ];
      }

      return input.placement === "inline" && !prompt.agentFence
        ? componentChildren({
            ...input,
            children: parseContentMarkdown(prompt.text),
          })
        : [{ lang: "text", type: "code", value: prompt.text }];
    },
    human(input, context) {
      const { audience, id, variant } = Schema.decodeUnknownSync(
        Schema.Struct({
          audience: Schema.optional(Schema.Literal("agent")),
          id: Schema.String,
          variant: Schema.optional(Schema.Literals(["primary", "text"])),
        })
      )(input.attributes);

      const prompt = Object.entries(copyPrompts).find(
        ([key]) => key === id
      )?.[1];

      if (prompt === undefined) {
        throw buildError("CopyPrompt", id, new Error("Unknown prompt id"));
      }

      if (audience === "agent") {
        return [];
      }

      return [
        html(context.renderCopyPrompt(promptForVariant(prompt, variant))),
      ];
    },
  },
  Diagram: {
    agent(input) {
      const { alt } = Schema.decodeUnknownSync(
        Schema.Struct({ alt: Schema.String })
      )(input.attributes);

      return [paragraph(`Diagram: ${alt}`), ...input.children.children];
    },
    human(input) {
      const { alt } = Schema.decodeUnknownSync(
        Schema.Struct({ alt: Schema.String })
      )(input.attributes);

      return [
        html(`<figure role="img" aria-label="${escapeHtml(alt)}">`),
        ...input.children.children,
        html(`<figcaption>${escapeHtml(alt)}</figcaption></figure>`),
      ];
    },
  },
  HumanOnly: {
    agent: () => [],
    human: componentChildren,
  },
  Sources: {
    agent(_input, context) {
      if (context.sources.length === 0) {
        return [];
      }

      return [
        {
          children: [{ type: "text", value: "Sources" }],
          depth: 2,
          type: "heading",
        },
        {
          children: context.sources.map((source) => ({
            children: [
              {
                children: [
                  source.kind === "linked"
                    ? {
                        children: [{ type: "text", value: source.title }],
                        type: "link",
                        url: source.url,
                      }
                    : { type: "text", value: source.title },
                  {
                    type: "text",
                    value:
                      source.kind === "linked"
                        ? `\n${source.publisher}. ${source.note} Accessed ${source.accessed}.`
                        : `\nRecorded ${source.recordedAt}. ${source.note}.`,
                  },
                ],
                type: "paragraph",
              },
            ],
            spread: false,
            type: "listItem",
          })),
          ordered: true,
          spread: true,
          start: 1,
          type: "list",
        },
      ];
    },
    human(_input, context) {
      return context.sources.length === 0
        ? []
        : [
            html(
              `<section class="bibliography" aria-labelledby="sources"><h2 id="sources">Sources</h2><ol>${context.sources.map((source) => (source.kind === "linked" ? `<li><a href="${escapeHtml(source.url)}">${escapeHtml(source.title)}</a>. ${escapeHtml(source.publisher)}. ${escapeHtml(source.note)} Accessed ${escapeHtml(source.accessed)}.</li>` : `<li>${escapeHtml(source.title)}. Recorded ${escapeHtml(source.recordedAt)}. ${escapeHtml(source.note)}.</li>`)).join("")}</ol></section>`
            ),
          ];
    },
  },
} satisfies ComponentRegistry;

export const createComponentRegistry = (
  extensions: ComponentRegistry = {}
): ComponentRegistry => {
  const registry = { ...coreComponents, ...extensions };

  for (const [name, definition] of Object.entries(registry)) {
    if (
      !Predicate.isFunction(definition.agent) ||
      !Predicate.isFunction(definition.human)
    ) {
      throw buildError(
        "component registry",
        name,
        new Error("Every component requires human and agent renderers")
      );
    }
  }

  return Object.freeze(registry);
};

export const componentContext = (
  options: Partial<ComponentRenderContext> = {}
): ComponentRenderContext => ({
  origin: options.origin ?? "https://ratstack.sh",
  pagePath: options.pagePath ?? "",
  renderCopyPrompt:
    options.renderCopyPrompt ??
    ((spec) => `<pre><code>${escapeHtml(spec.text)}</code></pre>`),
  sourcePath: options.sourcePath ?? "<inline>",
  sources: options.sources ?? [],
});

export const renderComponent = (
  registry: ComponentRegistry,
  target: ComponentTarget,
  input: ComponentInput,
  context: ComponentRenderContext
): readonly RootContent[] => {
  const component = registry[input.name];

  if (component === undefined || !Predicate.isFunction(component.agent)) {
    throw buildError(
      "component registry",
      context.sourcePath,
      new Error(`No agent renderer registered for ${input.name}`)
    );
  }

  const nodes = component[target](input, context);

  if (
    input.placement === "inline" &&
    nodes.some((node) => !phrasingTypes.has(node.type))
  ) {
    throw buildError(
      "component placement",
      context.sourcePath,
      new Error(`${input.name} emits blocks and must be placed on its own line`)
    );
  }

  return nodes;
};

interface ComponentRange {
  readonly attributes: Readonly<Record<string, string>>;
  readonly end: number;
  readonly innerEnd: number;
  readonly innerStart: number;
  readonly name: string;
  readonly start: number;
}

const phrasingHtml = (nodes: readonly RootContent[]): string =>
  nodes
    .map((node): string => {
      if (node.type === "text") {
        return escapeHtml(node.value);
      }

      if (node.type === "html") {
        return node.value;
      }

      if (node.type === "inlineCode") {
        return `<code>${escapeHtml(node.value)}</code>`;
      }

      if (node.type === "emphasis") {
        return `<em>${phrasingHtml(node.children)}</em>`;
      }

      if (node.type === "strong") {
        return `<strong>${phrasingHtml(node.children)}</strong>`;
      }

      if (node.type === "delete") {
        return `<del>${phrasingHtml(node.children)}</del>`;
      }

      if (node.type === "link") {
        return `<a href="${escapeHtml(node.url)}">${phrasingHtml(node.children)}</a>`;
      }

      if (node.type === "image") {
        return `<img src="${escapeHtml(node.url)}" alt="${escapeHtml(node.alt ?? "")}">`;
      }

      if (node.type === "break") {
        return "<br>";
      }

      throw buildError(
        "HTML component placement",
        node.type,
        new Error(
          "This component requires a Markdown block, not an inline HTML container"
        )
      );
    })
    .join("");

const hasOpenHtmlContainer = (prefix: string): boolean => {
  const stack: string[] = [];

  const voidElements = new Set([
    "area",
    "base",
    "br",
    "col",
    "embed",
    "hr",
    "img",
    "input",
    "link",
    "meta",
    "param",
    "source",
    "track",
    "wbr",
  ]);

  for (const token of htmlTokens(prefix)) {
    if (
      token.kind === "open" &&
      !token.selfClosing &&
      !voidElements.has(token.name.toLowerCase())
    ) {
      stack.push(token.name);
    } else if (token.kind === "close") {
      stack.pop();
    }
  }

  return stack.length > 0;
};

const nodeSourcePosition = (node: Nodes) => {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;

  return start === undefined || end === undefined ? undefined : { end, start };
};

const componentName = (name: string) =>
  name.charAt(0) >= "A" && name.charAt(0) <= "Z";

const componentRanges = (
  root: Root,
  source: string,
  sourcePath: string
): readonly ComponentRange[] => {
  const fragments: {
    sourceStart: number;
    streamStart: number;
    streamEnd: number;
    value: string;
  }[] = [];

  let streamLength = 0;
  visitContentNodes(root, (node) => {
    if (
      node.type !== "html" ||
      node.position?.start.offset === undefined ||
      node.position.end.offset === undefined
    ) {
      return;
    }

    const value = source.slice(
      node.position.start.offset,
      node.position.end.offset
    );

    fragments.push({
      sourceStart: node.position.start.offset,
      streamEnd: streamLength + value.length,
      streamStart: streamLength,
      value,
    });
    streamLength += value.length;
  });

  const sourceOffset = (offset: number, end: boolean) => {
    const fragment = fragments.find((item) =>
      end
        ? offset > item.streamStart && offset <= item.streamEnd
        : offset >= item.streamStart && offset < item.streamEnd
    );

    if (fragment === undefined) {
      throw buildError(
        "component position",
        sourcePath,
        new Error("HTML token has no source span")
      );
    }

    return fragment.sourceStart + offset - fragment.streamStart;
  };

  const ranges: ComponentRange[] = [];

  const pending: {
    attributes: Readonly<Record<string, string>>;
    name: string;
    start: number;
    innerStart: number;
  }[] = [];

  for (const token of htmlTokens(
    fragments.map((fragment) => fragment.value).join("")
  )) {
    if (!componentName(token.name)) {
      continue;
    }

    const start = sourceOffset(token.start, false);
    const end = sourceOffset(token.end, true);

    if (token.kind === "open") {
      if (
        Object.keys(token.attributes).some(
          (name) => !token.quotedAttributes.includes(name)
        )
      ) {
        throw buildError(
          "component attributes",
          sourcePath,
          new Error(
            `${token.name} accepts only quoted string attributes, not Svelte expressions`
          )
        );
      }

      if (token.selfClosing) {
        if (pending.length === 0) {
          ranges.push({
            attributes: token.attributes,
            end,
            innerEnd: end,
            innerStart: end,
            name: token.name,
            start,
          });
        }
      } else {
        pending.push({
          attributes: token.attributes,
          innerStart: end,
          name: token.name,
          start,
        });
      }
    } else {
      const opening = pending.pop();

      if (opening === undefined || opening.name !== token.name) {
        throw buildError(
          "component nesting",
          sourcePath,
          new Error(`Unmatched ${token.name} closing tag`)
        );
      }

      if (pending.length === 0) {
        ranges.push({ ...opening, end, innerEnd: start });
      }
    }
  }

  if (pending.length > 0) {
    throw buildError(
      "component nesting",
      sourcePath,
      new Error(`Unclosed ${pending.at(-1)?.name}`)
    );
  }

  return ranges;
};

export const sourcesContext = (
  source: string
): readonly BibliographySource[] => {
  const { sources } = frontmatterData(source);

  return Schema.decodeUnknownSync(Schema.Array(bibliographySourceSchema), {
    onExcessProperty: "error",
  })(sources ?? []);
};

export const transformComponentMarkdown = (
  source: string,
  target: ComponentTarget,
  context = componentContext(),
  registry = createComponentRegistry()
): Root => {
  const root = parseContentMarkdown(source, context.sourcePath);
  let usesSources = false;
  visitContentNodes(root, (node) => {
    if (
      node.type === "html" &&
      htmlTokens(node.value).some(
        (token) => token.kind === "open" && token.name === "Sources"
      )
    ) {
      usesSources = true;
    }
  });

  const renderContext =
    usesSources && context.sources.length === 0
      ? componentContext({ ...context, sources: sourcesContext(source) })
      : context;

  const ranges = componentRanges(root, source, context.sourcePath);

  const rewrite = (parent: Nodes): void => {
    if (!("children" in parent)) {
      return;
    }

    const result: RootContent[] = [];
    let skipUntil = -1;

    for (const child of parent.children) {
      const fenceInput = codeFenceInput(child);

      if (fenceInput !== undefined) {
        result.push(
          ...renderComponent(registry, target, fenceInput, renderContext)
        );
        continue;
      }

      const position = nodeSourcePosition(child);

      if (position === undefined) {
        result.push(child);
        continue;
      }

      const { start, end } = position;

      if (end <= skipUntil) {
        continue;
      }

      if (start < skipUntil && child.type === "html") {
        result.push(html(source.slice(skipUntil, end)));
        continue;
      }

      const range = ranges.find(
        (item) => item.start >= start && item.start < end
      );

      if (range === undefined) {
        rewrite(child);
        result.push(child);
        continue;
      }

      if (
        child.type === "html" &&
        range.end <= end &&
        hasOpenHtmlContainer(source.slice(start, range.start))
      ) {
        let cursor = start;
        let value = "";

        for (const nested of ranges.filter(
          (item) => item.start >= start && item.end <= end
        )) {
          value += source.slice(cursor, nested.start);

          const children = transformComponentMarkdown(
            source.slice(nested.innerStart, nested.innerEnd),
            target,
            renderContext,
            registry
          );

          value += phrasingHtml(
            renderComponent(
              registry,
              target,
              {
                attributes: nested.attributes,
                children,
                name: nested.name,
                placement: "inline",
              },
              renderContext
            )
          );
          cursor = nested.end;
        }

        result.push(html(value + source.slice(cursor, end)));
        continue;
      }

      if (child.type !== "html" && range.end <= end) {
        rewrite(child);
        result.push(child);
        continue;
      }

      if (range.start > start && child.type === "html") {
        result.push(html(source.slice(start, range.start)));
      }

      const children = transformComponentMarkdown(
        source.slice(range.innerStart, range.innerEnd),
        target,
        renderContext,
        registry
      );

      result.push(
        ...renderComponent(
          registry,
          target,
          {
            attributes: range.attributes,
            children,
            name: range.name,
            placement: parent.type === "paragraph" ? "inline" : "block",
          },
          renderContext
        )
      );
      skipUntil = range.end;

      if (range.end < end && child.type === "html") {
        result.push(
          ...transformComponentMarkdown(
            source.slice(range.end, end),
            target,
            renderContext,
            registry
          ).children
        );
      }
    }

    // SAFETY: Parsed mdast children and registered renderers both emit RootContent; the parent node itself and its mdast discriminant are preserved.
    (parent as { children: RootContent[] }).children = result;
  };

  rewrite(root);

  return root;
};

export const renderSvxMarkdown = (
  source: string,
  target: ComponentTarget,
  options: Partial<ComponentRenderContext> = {},
  registry = createComponentRegistry()
) =>
  stringifyContentMarkdown(
    transformComponentMarkdown(
      source,
      target,
      componentContext(options),
      registry
    )
  );

export const assertAgentPointerLayout = (
  markdown: string,
  pagePath: string
): void => {
  const root = parseContentMarkdown(markdown, pagePath);
  const pointers: Nodes[] = [];
  visitContentNodes(root, (node) => {
    if (node.type === "blockquote") {
      let label = "";
      visitContentNodes(node, (child) => {
        if (child.type === "text" || child.type === "inlineCode") {
          label += child.value;
        }
      });

      if (label.startsWith("For agents:")) {
        pointers.push(node);
      }
    }
  });

  const expected =
    pagePath === "/llms.txt" || pagePath === "/tokenmaxx" ? 0 : 1;

  const heading = root.children.findIndex(
    (node) => node.type === "heading" && node.depth === 1
  );

  if (
    pointers.length !== expected ||
    (expected === 1 && root.children[heading + 1] !== pointers[0])
  ) {
    throw buildError(
      "agent pointer layout",
      pagePath,
      new Error(
        `Expected ${expected} AgentPointer component immediately under the first H1, found ${pointers.length}`
      )
    );
  }
};

export const renderAgentPage = (
  source: string,
  pagePath: string,
  title: string,
  registry = createComponentRegistry()
): string => {
  const context = componentContext({ pagePath });
  const root = transformComponentMarkdown(source, "agent", context, registry);

  if (pagePath !== "/llms.txt" && pagePath !== "/tokenmaxx") {
    let heading = root.children.findIndex(
      (node) => node.type === "heading" && node.depth === 1
    );

    if (heading < 0) {
      const frontmatter = root.children[0]?.type === "yaml" ? 1 : 0;
      root.children.splice(frontmatter, 0, {
        children: [{ type: "text", value: title }],
        depth: 1,
        type: "heading",
      });
      heading = frontmatter;
    }

    root.children.splice(
      heading + 1,
      0,
      ...renderComponent(
        registry,
        "agent",
        {
          attributes: {},
          children: contentRoot([]),
          name: "AgentPointer",
          placement: "block",
        },
        context
      )
    );
  }

  const markdown = stringifyContentMarkdown(root);
  assertAgentPointerLayout(markdown, pagePath);

  return markdown;
};
