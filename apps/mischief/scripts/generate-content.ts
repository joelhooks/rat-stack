// @effect-diagnostics-next-line nodeBuiltinImport:off -- Build-only hashing uses Node's stable SHA-256 implementation.
import { createHash } from "node:crypto";

import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Drift, prepareCode } from "@rat-stack/code-snippets";
import type { Diagnostics } from "@rat-stack/code-snippets";
import { FenceHighlighter, shikiLayer } from "@rat-stack/code-snippets/shiki";
import { buildLoreGraph, LoreGraphSnapshotSchema } from "@rat-stack/lore/build";
import type { LoreBuildPage } from "@rat-stack/lore/build";
import { Resvg } from "@resvg/resvg-js";
import {
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Predicate,
  Schema,
  Stream,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { compile as compileMdsvex } from "mdsvex";
import satori from "satori";
import type { Component } from "svelte";
import { compile as compileSvelte } from "svelte/compiler";
import { render } from "svelte/server";

import { agentNextActions } from "../src/agent-guide.ts";
import { normalizeSources, contentPagePath } from "../src/content-data.ts";
import { markdownDiscoveryLinks } from "../src/content-links.ts";
import { houseAdCopy } from "../src/house-ad-copy.ts";
import { addInboundCounts, buildBacklinkIndex } from "./backlink-lib.ts";
import { collectBuildFences } from "./code-inputs.ts";
import { codeComponent } from "./code-pipeline.ts";
import type { ComponentRegistry } from "./component-registry.ts";
import {
  agentPointerHtml,
  componentContext,
  createComponentRegistry,
  renderSvxMarkdown,
  renderAgentPage,
  renderComponent,
} from "./component-registry.ts";
import { buildBlockIndex, paragraphAnchors } from "./content-blocks.ts";
import {
  assertDocumentTitle,
  assertLoreTerms,
  assertGlossaryLinks,
  frontmatterTerms,
  frontmatterValue,
  glossaryEntries,
  glossaryMarkdown,
  escapeSvelteBraces,
  assertSkillGroups,
  buildError,
  ContentBuildError,
  debtLedgerMarkdown,
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
  encodeIco,
  isDebtSourcePath,
  linkLoreTerms,
  loreLinkTargets,
  loreTermTargets,
  parseDebtLintOutput,
  parseLorePage,
  renderBibliography,
  responsiveTables,
  sectionOf,
  SYSTEMS_DIRECTORY,
  validateInternalLinks,
  withMarkdownTitle,
} from "./content-lib.ts";
import type { CopyPromptSpec, LoreTermTarget } from "./content-lib.ts";
import { linkStackEntities } from "./content-links.ts";
import {
  createRefComponent,
  extractBlockReferences,
  refIndexComponent,
  resolveReferencedBlock,
} from "./content-references.ts";
import { lawSpecs } from "./content-specs.ts";
import type { SourceSpec } from "./content-specs.ts";
import { dailyLogMarkdown, historyArgs } from "./daily-log.ts";
import { emitAssets } from "./emit-assets.ts";
import { openGitSnapshot } from "./git-snapshot.ts";
import { hasHouseAd, withHouseAdPointer } from "./house-ad.ts";
import { peerPins, PeerRows, renderPeers } from "./peers.ts";
import {
  groupUnlinkedMentions,
  linkedFromComponent,
  unlinkedMentionsComponent,
} from "./reference-components.ts";
import { contentDates, pageTitle, structuredData } from "./seo-metadata.ts";
import {
  contentCodeSpans,
  contentRoot,
  countHtmlElements,
  stringifyContentMarkdown,
  stripHtmlComments,
  normalizeHtmlAttributeNewlines,
} from "./svx-ast.ts";
import {
  collectUnlinkedProse,
  findUnlinkedMentions,
  UnlinkedMentionsSchema,
} from "./unlinked-mentions.ts";
import type { UnlinkedProse } from "./unlinked-mentions.ts";
import { wikiProseWarnings, wikiProseWarningText } from "./wiki-prose.ts";
import { writeFileAtomically } from "./write-file-atomically.ts";

const originToken = "__RATSTACK_ORIGIN__";

const repoUrl = "https://github.com/joelhooks/rat-stack";

const repoPathToken =
  /^(?:\.brain|\.pi|\.cursor|\.claude|apps|packages|scripts|skills|vendor)\/[\w./-]+$|^[\w.-]+\.(?:md|ts|js|json|yml|yaml|toml|schema)$/u;

const emptyTargets: ReadonlyMap<string, string> = new Map();

const codeSpans = (text: string): readonly string[] => [
  ...new Set(
    contentCodeSpans(text)
      .map((span) => span.trim())
      .filter((span) => span !== "")
  ),
];

const componentRegistry = createComponentRegistry();

const pointerInput = {
  attributes: {},
  children: contentRoot([]),
  name: "AgentPointer",
  placement: "block",
} as const;

const pointerContext = componentContext();

const agentPointerMarkdown = stringifyContentMarkdown(
  contentRoot(
    renderComponent(componentRegistry, "agent", pointerInput, pointerContext)
  )
);

const agentPointerHumanHtml = stringifyContentMarkdown(
  contentRoot(
    renderComponent(componentRegistry, "human", pointerInput, pointerContext)
  )
).trim();

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const svelteServerUrl = import.meta.resolve("svelte/internal/server");

interface PublicSpec extends SourceSpec {
  readonly rawText: string;
  readonly text: string;
}

interface OgPage {
  readonly description: string;
  readonly routePath: `/${string}`;
  readonly title: string;
}

interface DocumentProps {
  readonly AgentPointer?: ServerComponent;
  readonly agentPointerHtml?: string;
  readonly bodyHtml: string;
  readonly discoveryLinks:
    | ReturnType<typeof markdownDiscoveryLinks>
    | readonly [];
  readonly houseAdHtml?: string;
  readonly noindex?: boolean;
  readonly stylesheet: string;
  readonly breadcrumbHref?: string;
  readonly breadcrumbLabel?: string;
  readonly breadcrumbName?: string;
  readonly contentDates?: ReturnType<typeof contentDates>;
  readonly description: string;
  readonly ogImageUrl: string;
  readonly origin: string;
  readonly path: string;
  readonly title: string;
}

type ServerComponent = Component<
  Partial<DocumentProps> & Partial<Omit<CopyPromptSpec, "agentFence">>
>;

const digest = (text: string) =>
  createHash("sha256").update(text).digest("hex");

const ServerComponentSchema = Schema.declare(
  (value): value is ServerComponent => Predicate.isFunction(value)
);

const CompiledModule = Schema.Struct({ default: ServerComponentSchema });

const decodeCompiledModule = Schema.decodeUnknownSync(CompiledModule);

const decodeMdsvexOutput = Schema.decodeUnknownSync(
  Schema.Struct({ code: Schema.String })
);

type HastPropertyValue =
  | boolean
  | number
  | string
  | null
  | undefined
  | readonly (string | number)[];

interface HastNode {
  readonly type: string;
  readonly tagName?: string;
  readonly value?: string;
  properties?: Record<string, HastPropertyValue>;
  children?: HastNode[];
}

const nodeText = (node: HastNode): string =>
  node.value ?? (node.children ?? []).map(nodeText).join("");

const slugHeading = (value: string) =>
  value
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");

const stableHeadingIds = (): ((tree: HastNode) => void) => (tree) => {
  const used = new Set<string>();

  const reserve = (node: HastNode): void => {
    const id = node.properties?.id;

    if (Predicate.isString(id)) {
      used.add(id);
    }

    for (const child of node.children ?? []) {
      reserve(child);
    }
  };

  reserve(tree);

  const visit = (node: HastNode): void => {
    if (node.tagName !== undefined && /^h[1-6]$/u.test(node.tagName)) {
      const base = slugHeading(nodeText(node)) || "section";
      let id = base;
      let suffix = 2;

      while (used.has(id)) {
        id = `${base}-${suffix}`;
        suffix += 1;
      }

      used.add(id);
      node.properties = { ...node.properties, id };
    }

    for (const child of node.children ?? []) {
      visit(child);
    }
  };

  visit(tree);
};

const linkCodeSpans =
  (targets: ReadonlyMap<string, string>): (() => (tree: HastNode) => void) =>
  () => {
    const visit = (node: HastNode, insideBlock: boolean): void => {
      const children = node.children ?? [];

      for (const [index, child] of children.entries()) {
        if (!insideBlock && child.tagName === "code") {
          const href = targets.get(nodeText(child).trim());

          if (href !== undefined) {
            children[index] = {
              children: [child],
              properties: { href },
              tagName: "a",
              type: "element",
            };
            continue;
          }
        }

        visit(
          child,
          insideBlock ||
            child.tagName === "pre" ||
            child.tagName === "a" ||
            child.tagName === "th"
        );
      }
    };

    return (tree) => {
      visit(tree, false);
    };
  };

const compileName = (spec: SourceSpec) => {
  if (/\.(?:md|svx)$/u.test(spec.sourcePath)) {
    return spec.sourcePath;
  }

  return /\.(?:md|svx)$/u.test(spec.title) ? spec.title : `${spec.title}.md`;
};

const tagline =
  "An Effect stack so pure (aspirational) Kit Langton will blush.";

const linkedTagline = tagline.replace(
  "(aspirational)",
  "[(aspirational)](/debt.md)"
);

const trapRoutePath = "/--no-verify" as const;

const tokenmaxxRoutePath = "/tokenmaxx" as const;

const copyScript = `
for (const button of document.querySelectorAll("button[data-text]")) {
  const label = button.querySelector(".copy-label");
  const status = button.nextElementSibling;
  const done = button.querySelector(".icon-done");
  const idle = button.querySelector(".icon:not(.icon-done)");
  const original = label ? label.textContent : "";
  button.hidden = false;
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(button.dataset.text);
    } catch {
      const shown = button.parentElement.querySelector("pre");
      if (shown) getSelection().selectAllChildren(shown);
      return;
    }
    if (label) label.textContent = "Copied ✓";
    status.textContent = "Copied ✓";
    done.hidden = false;
    idle.hidden = true;
    setTimeout(() => {
      if (label) label.textContent = original;
      status.textContent = "";
      done.hidden = true;
      idle.hidden = false;
    }, 2000);
  });
}
`;

const copyScriptHash = `sha256-${createHash("sha256").update(copyScript).digest("base64")}`;

const unsubscribeBody = `
<h1>Unsubscribe</h1>
<p>__UNSUBSCRIBE_MESSAGE__</p>
__UNSUBSCRIBE_FORM__
`;

const interestResultBody = `
<h1>__INTEREST_HEADING__</h1>
<p>__INTEREST_MESSAGE__</p>
__INTEREST_LINK__
`;

const interestConfirmBody = `
<h1>Confirm your email</h1>
<p>You asked to hear about "how to burn a trillion tokens," a four-hour workshop on agent harnesses at ratstack.sh. Confirm your email to get one email when the date is set, and that's it.</p>
<form method="post" action="/tokenmaxx/confirm">
<input type="hidden" name="token" value="__INTEREST_TOKEN__" />
<p><button type="submit">Confirm my email</button></p>
</form>
`;

const noVerifyMarkdown = `# No verify.

The rat looks disappointed. The hook still runs.

Read [the fence](/lore/the-fence) and [the command policy](https://github.com/joelhooks/rat-stack/blob/main/scripts/vcs-command-policy.js).
`;

const ogImagePath = (routePath: string) =>
  `/og${routePath === "/" ? "/home" : routePath}.png`;

const escapeSvelteCodeHtml = (value: string) =>
  value
    .replaceAll("{", "&#123;")
    .replaceAll("}", "&#125;")
    .replaceAll("`", "&#96;");

const makeCodeHighlighter =
  (highlighter: FenceHighlighter["Service"]) =>
  (code: string, lang: string | null | undefined) =>
    escapeSvelteCodeHtml(highlighter.render(code, lang));

const makeOgElement = (page: OgPage, emojiDataUrl: string) => ({
  key: null,
  props: {
    children: [
      {
        key: null,
        props: {
          children: page.title,
          style: {
            fontSize: 64,
            fontWeight: 700,
            lineHeight: 1.1,
          },
        },
        type: "div",
      },
      {
        key: null,
        props: {
          children: page.description,
          style: {
            fontSize: 30,
            lineHeight: 1.35,
            marginTop: 24,
            maxWidth: 1000,
          },
        },
        type: "div",
      },
      {
        key: null,
        props: {
          src: emojiDataUrl,
          style: {
            bottom: 64,
            height: 96,
            position: "absolute",
            right: 64,
            width: 96,
          },
        },
        type: "img",
      },
    ],
    style: {
      backgroundColor: "#ffffff",
      color: "#000000",
      display: "flex",
      flexDirection: "column",
      height: 630,
      padding: 80,
      position: "relative",
      width: 1200,
    },
  },
  type: "div",
});

const renderOgImage = (
  page: OgPage,
  emojiSvg: string,
  regularFont: Buffer,
  boldFont: Buffer
) =>
  Effect.tryPromise({
    catch: (cause) => buildError("og image", page.routePath, cause),
    // @effect-diagnostics-next-line asyncFunction:off -- satori and resvg own this Promise boundary.
    try: async () => {
      const svg = await satori(
        makeOgElement(
          page,
          `data:image/svg+xml;base64,${Buffer.from(emojiSvg).toString("base64")}`
        ),
        {
          embedFont: true,
          fonts: [
            { data: regularFont, name: "JetBrains Mono", weight: 400 },
            { data: boldFont, name: "JetBrains Mono", weight: 700 },
          ],
          height: 630,
          width: 1200,
        }
      );

      return new Resvg(svg, {
        font: { loadSystemFonts: false },
      })
        .render()
        .asPng();
    },
  });

const renderRatPng = (ratSvg: string, size: number, background?: string) =>
  Effect.try({
    catch: (cause) => buildError("icon", "assets/emoji/1f400.svg", cause),
    try: () => {
      const options = {
        fitTo: { mode: "width", value: size },
        font: { loadSystemFonts: false },
      } as const;

      return new Resvg(
        ratSvg,
        background === undefined ? options : { ...options, background }
      )
        .render()
        .asPng();
    },
  });

const loadCompiledComponent = Effect.fn("loadCompiledComponent")(
  function* loadCompiledComponent(source: string, sourcePath: string) {
    const compiled = yield* Effect.try({
      catch: (cause) => buildError("Svelte compile", sourcePath, cause),
      try: () =>
        compileSvelte(source, {
          css: "injected",
          filename: sourcePath,
          generate: "server",
        }).js.code,
    });

    const executable = compiled.replaceAll(
      "'svelte/internal/server'",
      JSON.stringify(svelteServerUrl)
    );

    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(executable)}`;

    const loaded = yield* Effect.tryPromise({
      catch: (cause) => buildError("Svelte module load", sourcePath, cause),
      // oxlint-disable-next-line typescript/promise-function-async -- Node's module loader owns this Promise-returning boundary.
      try: () => import(moduleUrl).then(decodeCompiledModule),
    });

    return loaded.default;
  }
);

const copyPromptRenderer = Effect.fn("copyPromptRenderer")(
  function* copyPromptRenderer() {
    const fileSystem = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const sourcePath = "apps/mischief/src/copy-prompt.svelte";

    const source = yield* fileSystem
      .readFileString(
        path.join(import.meta.dirname, "../src/copy-prompt.svelte")
      )
      .pipe(Effect.mapError((cause) => buildError("read", sourcePath, cause)));

    const component = yield* loadCompiledComponent(source, sourcePath);

    return (spec: CopyPromptSpec) =>
      normalizeHtmlAttributeNewlines(
        stripHtmlComments(render(component, { props: spec }).body),
        "data-text"
      )
        .replaceAll("{", "&#123;")
        .replaceAll("}", "&#125;")
        .trim();
  }
);

const defaultGraphRegistry = createComponentRegistry({
  Ref: { agent: () => [], human: () => [] },
});

const compileMarkdownBody = Effect.fn("compileMarkdownBody")(
  function* compileMarkdownBody(
    source: string,
    sourcePath: string,
    highlighter: FenceHighlighter["Service"],
    targets: ReadonlyMap<string, string> = emptyTargets,
    loreTerms: readonly LoreTermTarget[] = [],
    routePath: string = sourcePath,
    registry: ComponentRegistry = defaultGraphRegistry
  ): Effect.fn.Return<
    {
      readonly bodyHtml: string;
      readonly unlinkedProse: readonly UnlinkedProse[];
      readonly linkedLoreRoutes: ReadonlySet<string>;
      readonly linkedLoreTerms: readonly {
        readonly target: string;
        readonly term: string;
      }[];
    },
    ContentBuildError,
    FileSystem.FileSystem | Path.Path
  > {
    const sourceLinks =
      registry.Ref !== defaultGraphRegistry.Ref &&
      extractBlockReferences(source).length > 0
        ? yield* compileMarkdownBody(
            source,
            sourcePath,
            highlighter,
            targets,
            loreTerms,
            routePath,
            createComponentRegistry({
              ...defaultGraphRegistry,
              Code: registry.Code ?? codeComponent(new Map()),
            })
          )
        : undefined;

    const linkedLoreRoutes = new Set<string>();
    const linkedLoreTerms = new Map<string, string>();
    const unlinkedProse: UnlinkedProse[] = [];

    const renderPrompt = source.includes("<CopyPrompt")
      ? yield* copyPromptRenderer()
      : undefined;

    const htmlSource = deriveHtmlMarkdown(source, renderPrompt, registry);

    const transformed = yield* Effect.tryPromise({
      catch: (cause) => buildError("mdsvex compile", sourcePath, cause),
      // @effect-diagnostics-next-line asyncFunction:off -- mdsvex owns this Promise boundary.
      try: async () =>
        await compileMdsvex(htmlSource, {
          extensions: [".md", ".svx"],
          filename: sourcePath,
          highlight: {
            highlighter: makeCodeHighlighter(highlighter),
            optimise: false,
          },
          rehypePlugins: [
            ...(["/lore/", "/systems/", "/skills/"].some((prefix) =>
              routePath.startsWith(prefix)
            )
              ? [paragraphAnchors(htmlSource)]
              : []),
            stableHeadingIds,
            responsiveTables,
            linkCodeSpans(targets),
            linkStackEntities,
            linkLoreTerms(
              loreTerms,
              routePath,
              linkedLoreRoutes,
              12,
              linkedLoreTerms
            ),
            collectUnlinkedProse(unlinkedProse),
            escapeSvelteBraces,
          ],
        }).then(decodeMdsvexOutput),
    });

    const component = yield* loadCompiledComponent(
      transformed.code,
      sourcePath
    );

    const bodyHtml = yield* Effect.try({
      catch: (cause) => buildError("Svelte body render", sourcePath, cause),
      try: () => render(component, { props: {} }).body,
    });

    return {
      bodyHtml,
      linkedLoreRoutes: sourceLinks?.linkedLoreRoutes ?? linkedLoreRoutes,
      linkedLoreTerms:
        sourceLinks?.linkedLoreTerms ??
        [...linkedLoreTerms].map(([target, term]) => ({
          target,
          term,
        })),
      unlinkedProse: sourceLinks?.unlinkedProse ?? unlinkedProse,
    };
  }
);

const assertWovenLoreRoutes = (
  pages: readonly {
    readonly routes: ReadonlySet<string>;
    readonly sourcePath: string;
  }[],
  knownRoutes: ReadonlySet<string>
) => {
  for (const page of pages) {
    for (const route of page.routes) {
      if (!knownRoutes.has(route)) {
        throw buildError(
          `internal link ${route}`,
          page.sourcePath,
          new Error(`resolves to unserved route ${route}`)
        );
      }
    }
  }
};

const validateLoreTermClaims = (
  pages: Parameters<typeof assertLoreTerms>[0],
  sourcePath: string
) =>
  Effect.try({
    catch: (cause) =>
      Schema.is(ContentBuildError)(cause)
        ? cause
        : buildError("lore terms", sourcePath, cause),
    try: () => {
      assertLoreTerms(pages);
    },
  });

const renderDocument = Effect.fn("renderDocument")(function* renderDocument(
  shell: ServerComponent,
  props: DocumentProps,
  sourcePath: string
) {
  const fileSystem = yield* FileSystem.FileSystem;

  const pointerSource = yield* fileSystem
    .readFileString(
      new URL("../src/agent-pointer.svelte", import.meta.url).pathname
    )
    .pipe(
      Effect.mapError((cause) =>
        buildError("read", "agent-pointer.svelte", cause)
      )
    );

  const AgentPointer = yield* loadCompiledComponent(
    pointerSource,
    "agent-pointer.svelte"
  );

  const rendered = yield* Effect.try({
    catch: (cause) => buildError("Svelte document render", sourcePath, cause),
    try: () =>
      render(shell, {
        props: {
          ...props,
          AgentPointer,
          agentPointerHtml: agentPointerHumanHtml,
          bodyHtml: `${countHtmlElements(props.bodyHtml, "h1") > 0 ? props.bodyHtml : `<h1>${escapeHtml(props.breadcrumbName ?? props.title)}</h1>${props.bodyHtml}`}${props.contentDates?.dateModified === undefined ? "" : `<p>Content updated <time datetime="${props.contentDates.dateModified}">${props.contentDates.dateModified}</time>.</p>`}`,
        },
      }),
  });

  const document = `<!doctype html>
<html lang="en">
<head>${rendered.head}${props.noindex === true ? "" : structuredData({ dates: props.contentDates ?? {}, description: props.description, origin: props.origin, path: props.path, title: props.breadcrumbName ?? props.title })}</head>
<body>${props.path === "/tokenmaxx" ? "" : `<!-- ${agentPointerHtml} -->`}${rendered.body}</body>
</html>`;

  if (
    countHtmlElements(
      `<!doctype html><html><head>${rendered.head}</head><body>${rendered.body}</body></html>`,
      "script"
    ) > 0
  ) {
    return yield* new ContentBuildError({
      cause: new Error("Static documents must not contain client scripts"),
      sourcePath,
      stage: "Svelte document render",
    });
  }

  yield* Effect.try({
    catch: (cause) => buildError("document title", sourcePath, cause),
    try: () => {
      assertDocumentTitle(document, sourcePath);
    },
  });

  return document;
});

const entryList = (
  resources: readonly {
    readonly description: string;
    readonly routePath: string;
    readonly title?: string;
    readonly name?: string;
  }[]
) =>
  resources
    .map(
      (resource) =>
        `- [${resource.title ?? resource.name ?? resource.routePath}](${resource.routePath}) — ${resource.description}`
    )
    .join("\n");

const sourceLiteral = (value: Schema.Json) =>
  JSON.stringify(value, null, 2).replaceAll(
    "@effect-diagnostics",
    "\\u0040effect-diagnostics"
  );

const PackageDependencies = Schema.Record(Schema.String, Schema.String);

const PackageJson = Schema.Struct({
  dependencies: Schema.optional(PackageDependencies),
  devDependencies: Schema.optional(PackageDependencies),
  name: Schema.optional(Schema.String),
  optionalDependencies: Schema.optional(PackageDependencies),
  peerDependencies: Schema.optional(PackageDependencies),
});

const skillGroups = [
  { names: ["rat-stack-mode"], title: "Start here" },
  {
    names: ["learn-rat-stack", "learn-alchemy", "find-peers"],
    title: "See how the pieces fit",
  },
  {
    names: [
      "add-a-capability",
      "add-a-lifecycle-machine",
      "add-a-store",
      "write-a-wiki-page",
    ],
    title: "Learn by building",
  },
  { names: ["keep-or-cut", "uncomplect"], title: "Choose what you keep" },
  { names: ["gardener"], title: "Keep the fence sharp" },
  { names: ["ship"], title: "Ship with evidence" },
] as const;

const runDebtLint = Effect.fn("runDebtLint")(function* runDebtLint(
  root: string,
  debtSourcePaths: readonly string[]
) {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

  const command = ChildProcess.make(
    "pnpm",
    [
      "exec",
      "oxlint",
      "--config",
      "scripts/oxlint-debt-ledger.config.ts",
      "-A",
      "all",
      "-D",
      "rat-stack-debt/debt-ledger",
      "--format",
      "json",
      "--no-ignore",
      ...debtSourcePaths,
    ],
    { cwd: root }
  );

  const process = yield* Effect.scoped(
    Effect.gen(function* runDebtLintProcess() {
      const handle = yield* spawner
        .spawn(command)
        .pipe(
          Effect.mapError((cause) => buildError("debt lint", "oxlint", cause))
        );

      const [json, stderr] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" }
      ).pipe(
        Effect.mapError((cause) =>
          buildError("debt lint output", "oxlint", cause)
        )
      );

      const exitCode = yield* handle.exitCode.pipe(
        Effect.mapError((cause) =>
          buildError("debt lint exit", "oxlint", cause)
        )
      );

      return { exitCode, json, stderr };
    })
  );

  const lint = yield* Effect.try({
    catch: (cause) =>
      Schema.is(ContentBuildError)(cause)
        ? cause
        : buildError("debt lint JSON", "oxlint", cause),
    try: () => parseDebtLintOutput(process.json),
  });

  if (process.exitCode !== 0 && process.exitCode !== 1) {
    return yield* buildError(
      "debt lint exit",
      "oxlint",
      new Error(`Oxlint exited ${process.exitCode}: ${process.stderr}`)
    );
  }

  if (lint.fileCount !== debtSourcePaths.length || lint.ruleCount !== 1) {
    return yield* buildError(
      "debt lint scope",
      "oxlint",
      new Error(
        `Expected ${debtSourcePaths.length} files and one rule; oxlint checked ${lint.fileCount} files and ${lint.ruleCount} rules.`
      )
    );
  }

  return lint;
});

const reportCodeDiagnostics = (diagnostics: readonly Diagnostics[]) =>
  Effect.forEach(
    diagnostics,
    (diagnostic: Diagnostics) =>
      Effect.logWarning(
        `${diagnostic.sourcePath}:${diagnostic.line} ${diagnostic.message}`
      ),
    { discard: true }
  );

const program = Effect.gen(function* generateContent() {
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const root = path.resolve(import.meta.dirname, "../../..");

  const output = path.join(
    root,
    "apps/mischief/src/bundled-content.generated.ts"
  );

  const highlighter = yield* FenceHighlighter;

  const readText = (sourcePath: string) =>
    fileSystem
      .readFileString(path.join(root, sourcePath))
      .pipe(Effect.mapError((cause) => buildError("read", sourcePath, cause)));

  const snapshot = yield* openGitSnapshot(
    root,
    process.argv.includes("--git-snapshot")
  );

  const fences = yield* collectBuildFences(root);
  yield* snapshot.verifyFences(fences);

  const preparedCode = yield* prepareCode(fences).pipe(
    Effect.provide(Layer.provideMerge(Drift.layer, snapshot.sourceLayer))
  );

  yield* reportCodeDiagnostics(preparedCode.diagnostics);

  const Code = codeComponent(preparedCode.snippets);

  const blockIndexRegistry = createComponentRegistry({
    Code,
    Ref: refIndexComponent,
  });

  const graphRegistry = createComponentRegistry({
    Code,
    Ref: { agent: () => [], human: () => [] },
  });

  const directoryNames = (directory: string, entries: readonly string[]) =>
    Effect.forEach(
      entries,
      (entry) =>
        fileSystem.stat(path.join(root, directory, entry)).pipe(
          Effect.mapError((cause) =>
            buildError("stat directory", `${directory}/${entry}`, cause)
          ),
          Effect.map((info) => (info.type === "Directory" ? entry : undefined))
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((results) =>
        results.filter((entry): entry is string => entry !== undefined)
      )
    );

  const sourceFilesIn: (
    directory: string
  ) => Effect.Effect<readonly string[], ContentBuildError> = (directory) =>
    Effect.gen(function* findSourceFiles() {
      const entries = yield* fileSystem
        .readDirectory(path.join(root, directory))
        .pipe(
          Effect.mapError((cause) =>
            buildError("read directory", directory, cause)
          )
        );

      const directories = yield* directoryNames(directory, entries);
      const directorySet = new Set(directories);

      const files = entries
        .filter(
          (entry) =>
            !directorySet.has(entry) &&
            isDebtSourcePath(`${directory}/${entry}`)
        )
        .map((entry) => `${directory}/${entry}`);

      const children = yield* Effect.forEach(
        directories.filter((entry) =>
          isDebtSourcePath(`${directory}/${entry}/source.ts`)
        ),
        (entry) => sourceFilesIn(`${directory}/${entry}`),
        { concurrency: "unbounded" }
      );

      return [...files, ...children.flat()];
    });

  const stylesheet = yield* readText("apps/mischief/src/rat.css");
  const shellSource = yield* readText("apps/mischief/src/document.svelte");

  const shell = yield* loadCompiledComponent(
    shellSource,
    "apps/mischief/src/document.svelte"
  );

  const emojiSvg = stripHtmlComments(
    yield* readText("assets/emoji/1f400.svg")
  ).trim();

  const regularFont = yield* fileSystem
    .readFile(path.join(root, "assets/fonts/JetBrainsMono-Regular.ttf"))
    .pipe(
      Effect.mapError((cause) =>
        buildError("og image", "assets/fonts/JetBrainsMono-Regular.ttf", cause)
      )
    );

  const boldFont = yield* fileSystem
    .readFile(path.join(root, "assets/fonts/JetBrainsMono-Bold.ttf"))
    .pipe(
      Effect.mapError((cause) =>
        buildError("og image", "assets/fonts/JetBrainsMono-Bold.ttf", cause)
      )
    );

  const houseAdSourcePath = "apps/mischief/src/house-ad.svelte";

  const houseAdComponent = yield* loadCompiledComponent(
    yield* readText(houseAdSourcePath),
    houseAdSourcePath
  );

  const houseAdHtml = render(houseAdComponent, { props: houseAdCopy }).body;

  const peerSourcePath = ".brain/resources/peers.svx";
  const peerDataPath = ".brain/data/peers.json";

  const peerInputs = yield* Effect.all({
    core: readText("packages/core/package.json"),
    data: readText(peerDataPath),
    infra: readText("apps/infra/package.json"),
    root: readText("package.json"),
    template: readText(peerSourcePath),
  });

  const peerRows = yield* Schema.decodeEffect(Schema.fromJsonString(PeerRows))(
    peerInputs.data
  ).pipe(
    Effect.mapError((cause) => buildError("peers decode", peerDataPath, cause))
  );

  const peersMarkdown = yield* Effect.try({
    catch: (cause) => buildError("peers render", peerDataPath, cause),
    try: () =>
      renderPeers(
        peerInputs.template,
        peerRows,
        peerPins(peerInputs.root, peerInputs.infra, peerInputs.core)
      ),
  });

  const lawTexts: readonly PublicSpec[] = yield* Effect.forEach(
    lawSpecs,
    (spec) =>
      readText(spec.sourcePath).pipe(
        Effect.map((source) =>
          spec.sourcePath === peerSourcePath ? peersMarkdown : source
        ),
        Effect.map((rawText) => ({
          ...spec,
          rawText,
          text: deriveAgentMarkdown(rawText, graphRegistry),
        }))
      ),
    { concurrency: "unbounded" }
  );

  const sourceDirectories = yield* Effect.forEach(
    ["apps", "packages", "scripts", "tools"],
    sourceFilesIn,
    { concurrency: "unbounded" }
  );

  const rootEntries = yield* fileSystem
    .readDirectory(root)
    .pipe(Effect.mapError((cause) => buildError("read directory", ".", cause)));

  const debtSourcePaths = [
    ...sourceDirectories.flat(),
    ...rootEntries
      .filter((entry) => /^[^/]+\.config\.ts$/u.test(entry))
      .map((entry) => entry),
  ]
    .filter(isDebtSourcePath)
    .toSorted();

  const debtLint = yield* runDebtLint(root, debtSourcePaths);
  const debtMarkdown = debtLedgerMarkdown(debtLint.entries);

  const packageDirectoryGroups = yield* Effect.forEach(
    ["apps", "packages"],
    (directory) =>
      Effect.gen(function* findPackageFiles() {
        const entries = yield* fileSystem
          .readDirectory(path.join(root, directory))
          .pipe(
            Effect.mapError((cause) =>
              buildError("read directory", directory, cause)
            )
          );

        const directories = yield* directoryNames(directory, entries);

        return directories.map((entry) => `${directory}/${entry}/package.json`);
      }),
    { concurrency: "unbounded" }
  );

  const packagePaths = [
    "package.json",
    ...packageDirectoryGroups.flat(),
  ].toSorted();

  const packagePins = yield* Effect.forEach(
    packagePaths,
    (sourcePath) =>
      Effect.gen(function* readPackagePins() {
        const packageText = yield* readText(sourcePath);

        const json = yield* Schema.decodeEffect(
          Schema.fromJsonString(PackageJson)
        )(packageText).pipe(
          Effect.mapError((cause) =>
            buildError("package JSON decode", sourcePath, cause)
          )
        );

        const dependencies = [
          ...Object.entries(json.dependencies ?? {}).map(([name, version]) => ({
            kind: "dependency",
            name,
            version,
          })),
          ...Object.entries(json.devDependencies ?? {}).map(
            ([name, version]) => ({ kind: "devDependency", name, version })
          ),
          ...Object.entries(json.optionalDependencies ?? {}).map(
            ([name, version]) => ({ kind: "optionalDependency", name, version })
          ),
          ...Object.entries(json.peerDependencies ?? {}).map(
            ([name, version]) => ({ kind: "peerDependency", name, version })
          ),
        ].toSorted((left, right) => left.name.localeCompare(right.name));

        return {
          dependencies,
          name: json.name ?? sourcePath,
          sourcePath,
        };
      }),
    { concurrency: "unbounded" }
  );

  const pinsText = [
    "# Workspace pins",
    "",
    "Generated from every workspace `package.json`. The package files remain the source of truth.",
    "",
    ...packagePins.flatMap((workspace) => [
      `## ${workspace.name}`,
      "",
      `Source: \`${workspace.sourcePath}\``,
      "",
      "| Package | Kind | Version |",
      "| --- | --- | --- |",
      ...workspace.dependencies.map(
        (dependency) =>
          `| \`${dependency.name}\` | ${dependency.kind} | \`${dependency.version}\` |`
      ),
      "",
    ]),
  ].join("\n");

  const publicSpecsForLog = (logText: string): readonly PublicSpec[] => [
    ...lawTexts.slice(0, 4),
    {
      description:
        "Exact dependency values declared by every workspace package.",
      rawText: pinsText,
      routePath: "/pins.md",
      sourcePath: "workspace package.json files",
      text: pinsText,
      title: "Exact workspace dependency pins (pins.md)",
    },
    {
      description: "What changed in the files served here, newest first.",
      rawText: logText,
      routePath: "/log",
      sourcePath: "git history",
      text: logText,
      title: "Change log",
    },
    {
      description: "The generated change log as Markdown.",
      rawText: logText,
      routePath: "/log.md",
      sourcePath: "git history",
      text: logText,
      title: "Source change history (log.md)",
    },
    {
      description: "A source-linked count of repo-owned lint and type escapes.",
      rawText: debtMarkdown,
      routePath: "/debt.md",
      sourcePath: "repo source comments",
      text: debtMarkdown,
      title: "Lint and type escape ledger (debt.md)",
    },
    ...lawTexts.slice(4),
  ];

  const skillEntries = yield* fileSystem
    .readDirectory(path.join(root, "skills"))
    .pipe(
      Effect.mapError((cause) => buildError("read directory", "skills", cause))
    );

  const skillDirectories = yield* directoryNames("skills", skillEntries);

  const skillTexts = yield* Effect.forEach(
    skillDirectories.toSorted(),
    (directoryName) =>
      Effect.gen(function* readSkill() {
        const sourcePath = `skills/${directoryName}/SKILL.md`;
        const rawText = yield* readText(sourcePath);
        const text = deriveAgentMarkdown(rawText, blockIndexRegistry);

        const name = yield* Effect.try({
          catch: (cause) => buildError("frontmatter", sourcePath, cause),
          try: () => frontmatterValue(text, "name"),
        });

        if (name !== directoryName) {
          return yield* new ContentBuildError({
            cause: new Error(
              `Skill directory ${directoryName} does not match frontmatter name ${name}`
            ),
            sourcePath,
            stage: "frontmatter",
          });
        }

        const description = yield* Effect.try({
          catch: (cause) => buildError("frontmatter", sourcePath, cause),
          try: () => frontmatterValue(text, "description"),
        });

        const routePath = `/skills/${name}` as const;

        return { description, name, rawText, routePath, sourcePath, text };
      }),
    { concurrency: "unbounded" }
  );

  yield* Effect.try({
    catch: (cause) =>
      Schema.is(ContentBuildError)(cause)
        ? cause
        : buildError("skill grouping", "skills", cause),
    try: () => {
      assertSkillGroups(
        skillTexts.map((skill) => skill.name),
        skillGroups
      );
    },
  });

  const loreDirectory = ".brain/resources/lore";

  const readLoreDirectory = (directory: string) =>
    Effect.gen(function* readLoreDirectoryPages() {
      const entries = yield* fileSystem
        .readDirectory(path.join(root, directory))
        .pipe(
          Effect.mapError((cause) =>
            buildError("read directory", directory, cause)
          )
        );

      return yield* Effect.forEach(
        entries.filter((entry) => entry.endsWith(".svx")).toSorted(),
        (filename) =>
          Effect.gen(function* readLorePage() {
            const sourcePath = `${directory}/${filename}`;
            const rawText = yield* readText(sourcePath);

            const metadata = yield* Effect.try({
              catch: (cause) =>
                Schema.is(ContentBuildError)(cause)
                  ? cause
                  : buildError("frontmatter", sourcePath, cause),
              try: () => parseLorePage(sourcePath, rawText),
            });

            return {
              ...metadata,
              rawText,
              text: deriveAgentMarkdown(rawText, blockIndexRegistry),
            };
          }),
        { concurrency: "unbounded" }
      );
    });

  const loreTexts = (yield* Effect.forEach(
    [loreDirectory, SYSTEMS_DIRECTORY],
    readLoreDirectory
  )).flat();

  const proseWarnings = loreTexts.flatMap((page) =>
    wikiProseWarnings(page.sourcePath, page.rawText)
  );

  for (const warning of proseWarnings) {
    yield* Effect.logWarning(wikiProseWarningText(warning));
  }

  yield* Effect.logInfo(`Wiki prose warnings: ${proseWarnings.length}`);

  const logText = dailyLogMarkdown(yield* snapshot.query(historyArgs), [
    ...lawSpecs,
    ...skillTexts.map((skill) => ({ ...skill, title: skill.name })),
    ...loreTexts,
  ]);

  const publicSpecs = publicSpecsForLog(logText);

  const blockIndex = yield* buildBlockIndex([
    ...skillTexts.map((skill) => ({
      ...skill,
      rawText: deriveHtmlMarkdown(skill.rawText, undefined, blockIndexRegistry),
      title: skill.name,
    })),
    ...loreTexts.map((lore) => ({
      ...lore,
      rawText: deriveHtmlMarkdown(lore.rawText, undefined, blockIndexRegistry),
    })),
  ]);

  yield* Effect.try({
    catch: (cause) =>
      Schema.is(ContentBuildError)(cause)
        ? cause
        : buildError("block reference", loreDirectory, cause),
    try: () => {
      for (const page of [...skillTexts, ...loreTexts]) {
        for (const ref of extractBlockReferences(page.rawText)) {
          resolveReferencedBlock(ref, page.sourcePath, blockIndex);
        }
      }
    },
  });

  const blockReferenceRegistry = createComponentRegistry({
    Code,
    Ref: createRefComponent(blockIndex),
  });

  const systemTexts = loreTexts.filter((lore) => lore.group === "system");

  yield* validateLoreTermClaims(loreTexts, loreDirectory);

  const loreTermIndex = loreTermTargets(loreTexts);
  const servedRoutes = new Map<string, string>();
  const titles = new Map<string, string>();

  const pageKinds = new Map<string, string>([
    ["/", "Home"],
    ["/skills", "Skill index"],
    ["/lore", "Lore index"],
    ["/systems", "Systems index"],
    ["/llms.txt", "Agent guide"],
    ["/llms-full.txt", "Full agent guide"],
    [trapRoutePath, "Generated page"],
  ]);

  titles.set("/", "Home");
  titles.set("/skills", "Learn the stack");
  titles.set("/lore", "Rat Stack lore");
  titles.set("/systems", "Rat Stack systems");
  titles.set("/llms.txt", "Agent guide");
  titles.set("/llms-full.txt", "Full agent guide");
  titles.set(trapRoutePath, "No verify");

  for (const spec of publicSpecs) {
    servedRoutes.set(spec.sourcePath, spec.routePath);
    servedRoutes.set(spec.title, spec.routePath);
    titles.set(spec.routePath, spec.title);
    pageKinds.set(spec.routePath, "Source file");
  }

  for (const skill of skillTexts) {
    servedRoutes.set(skill.name, skill.routePath);
    titles.set(skill.routePath, skill.name);
    pageKinds.set(skill.routePath, "Skill");
  }

  for (const lore of loreTexts) {
    servedRoutes.set(lore.slug, lore.routePath);
    servedRoutes.set(lore.sourcePath, lore.routePath);
    titles.set(lore.routePath, lore.title);
    pageKinds.set(lore.routePath, sectionOf(lore.group).kind);
  }

  const loreMarkdownLinks = (routes: ReadonlySet<string>) =>
    [...routes]
      .map((route) => `- [${titles.get(route) ?? route}](${route})`)
      .join("\n");

  const appendLoreMarkdown = (text: string, routes: ReadonlySet<string>) => {
    const links = loreMarkdownLinks(routes);

    return links === ""
      ? text
      : `${text.trimEnd()}\n\n## Lore on this page\n\n${links}\n`;
  };

  const resolveTarget = (
    span: string,
    selfRoute: string
  ): Effect.Effect<Option.Option<string>> =>
    Effect.gen(function* resolveSpan() {
      const served = servedRoutes.get(span);

      if (served === selfRoute) {
        return Option.none();
      }

      if (served !== undefined) {
        return Option.some(served);
      }

      if (
        !repoPathToken.test(span) ||
        span.includes(".generated.") ||
        span.split("/").includes("node_modules")
      ) {
        return Option.none();
      }

      const relative = span.replace(/\/$/u, "");
      const absolute = path.join(root, relative);

      const exists = yield* fileSystem
        .exists(absolute)
        .pipe(Effect.orElseSucceed(() => false));

      if (!exists) {
        return Option.none();
      }

      const info = yield* fileSystem
        .stat(absolute)
        .pipe(Effect.orElseSucceed(() => null));

      const kind = info?.type === "Directory" ? "tree" : "blob";

      return Option.some(`${repoUrl}/${kind}/main/${relative}`);
    });

  const resolveTargets = (text: string, selfRoute: string) =>
    Effect.forEach(
      codeSpans(text),
      (span) =>
        resolveTarget(span, selfRoute).pipe(
          Effect.map((href) => ({ href, span }))
        ),
      { concurrency: "unbounded" }
    ).pipe(
      Effect.map((pairs) => {
        const targets = new Map<string, string>();

        for (const pair of pairs) {
          if (Option.isSome(pair.href)) {
            targets.set(pair.span, pair.href.value);
          }
        }

        return targets;
      })
    );

  const publicTargets = yield* Effect.forEach(
    publicSpecs,
    (spec) => resolveTargets(spec.text, spec.routePath),
    { concurrency: "unbounded" }
  );

  const skillTargets = yield* Effect.forEach(
    skillTexts,
    (skill) => resolveTargets(skill.text, skill.routePath),
    { concurrency: "unbounded" }
  );

  const loreCodeTargets = yield* Effect.forEach(
    loreTexts,
    (lore) => resolveTargets(lore.text, lore.routePath),
    { concurrency: "unbounded" }
  );

  const loreRoutes = new Set([
    "/lore",
    "/systems",
    "/skills",
    ...skillTexts.map((skill) => skill.routePath),
    ...loreTexts.map((lore) => lore.routePath),
  ]);

  const lorePageLinks = yield* Effect.forEach(
    loreTexts,
    (lore) =>
      Effect.try({
        catch: (cause) =>
          Schema.is(ContentBuildError)(cause)
            ? cause
            : buildError("lore link", lore.sourcePath, cause),
        try: () => loreLinkTargets(lore.sourcePath, lore.text, loreRoutes),
      }),
    { concurrency: "unbounded" }
  );

  const linkTargetsBySource = new Map<string, Set<string>>();

  const recordLoreRoutes = (from: string, routes: Iterable<string>) => {
    const targets = linkTargetsBySource.get(from) ?? new Set<string>();

    for (const route of routes) {
      targets.add(route);
    }

    linkTargetsBySource.set(from, targets);
  };

  const recordLinks = (from: string, targets: ReadonlyMap<string, string>) => {
    recordLoreRoutes(
      from,
      [...targets.values()].filter((href) => href.startsWith("/"))
    );
  };

  for (const [index, spec] of publicSpecs.entries()) {
    recordLinks(spec.routePath, publicTargets[index] ?? emptyTargets);
  }

  for (const [index, skill] of skillTexts.entries()) {
    recordLinks(skill.routePath, skillTargets[index] ?? emptyTargets);
  }

  for (const [index, lore] of loreTexts.entries()) {
    recordLinks(lore.routePath, loreCodeTargets[index] ?? emptyTargets);

    recordLoreRoutes(lore.routePath, lorePageLinks[index] ?? []);
  }

  const lastChange = (sourcePath: string) =>
    snapshot.track(sourcePath).pipe(
      Effect.andThen(
        snapshot.query([
          "log",
          "-n",
          "1",
          "--date=short",
          "--format=%ad%x09%H%x09%h",
          "--",
          sourcePath,
        ])
      ),
      Effect.map((line) => {
        const [date, hash, short] = line.trim().split("\t");

        return date === undefined || hash === undefined || short === undefined
          ? undefined
          : { date, hash, short };
      })
    );

  const lastChanges = new Map<
    string,
    { date: string; hash: string; short: string }
  >();

  const trackedPaths = [
    ...publicSpecs.map((spec) => spec.sourcePath),
    ...skillTexts.map((skill) => skill.sourcePath),
    ...loreTexts.map((lore) => lore.sourcePath),
  ].filter((sourcePath) => !sourcePath.includes(" "));

  const changes = yield* Effect.forEach(
    trackedPaths,
    (sourcePath) =>
      lastChange(sourcePath).pipe(
        Effect.map((change) => ({ change, sourcePath }))
      ),
    { concurrency: "unbounded" }
  );

  for (const { change, sourcePath } of changes) {
    if (change !== undefined) {
      lastChanges.set(sourcePath, change);
    }
  }

  const lawBodies = yield* Effect.forEach(
    publicSpecs.map((spec, index) => ({
      spec,
      targets: publicTargets[index] ?? emptyTargets,
    })),
    ({ spec, targets }) =>
      Effect.gen(function* renderPublicBody() {
        const { bodyHtml, linkedLoreRoutes, linkedLoreTerms, unlinkedProse } =
          yield* compileMarkdownBody(
            spec.rawText,
            compileName(spec),
            highlighter,
            targets,
            loreTermIndex,
            spec.routePath,
            graphRegistry
          );

        return {
          bodyHtml,
          linkedLoreRoutes,
          linkedLoreTerms,
          spec: {
            ...spec,
            text: appendLoreMarkdown(spec.text, linkedLoreRoutes),
          },
          unlinkedProse,
        };
      }),
    { concurrency: "unbounded" }
  );

  const skillBodies = yield* Effect.forEach(
    skillTexts.map((skill, index) => ({
      skill,
      targets: skillTargets[index] ?? emptyTargets,
    })),
    ({ skill, targets }) =>
      Effect.gen(function* renderSkillBody() {
        const { bodyHtml, linkedLoreRoutes, linkedLoreTerms, unlinkedProse } =
          yield* compileMarkdownBody(
            skill.rawText,
            skill.sourcePath,
            highlighter,
            targets,
            loreTermIndex,
            skill.routePath,
            blockReferenceRegistry
          );

        return {
          bodyHtml,
          linkedLoreRoutes,
          linkedLoreTerms,
          skill: {
            ...skill,
            text: appendLoreMarkdown(
              deriveAgentMarkdown(skill.rawText, blockReferenceRegistry),
              linkedLoreRoutes
            ),
          },
          unlinkedProse,
        };
      }),
    { concurrency: "unbounded" }
  );

  const loreBodies = yield* Effect.forEach(
    loreTexts.map((lore, index) => ({
      lore,
      targets: loreCodeTargets[index] ?? emptyTargets,
    })),
    ({ lore, targets }) =>
      Effect.gen(function* renderLoreBody() {
        const { bodyHtml, linkedLoreRoutes, linkedLoreTerms, unlinkedProse } =
          yield* compileMarkdownBody(
            lore.rawText,
            lore.sourcePath,
            highlighter,
            targets,
            loreTermIndex,
            lore.routePath,
            blockReferenceRegistry
          );

        const bibliography = renderBibliography(lore.bibliography);

        return {
          bodyHtml: `${bodyHtml}${bibliography.html}`,
          linkedLoreRoutes,
          linkedLoreTerms,
          lore: {
            ...lore,
            text: appendLoreMarkdown(
              `${withMarkdownTitle(deriveAgentMarkdown(lore.rawText, blockReferenceRegistry), lore.title, bodyHtml)}${bibliography.markdown}`,
              linkedLoreRoutes
            ),
          },
          unlinkedProse,
        };
      }),
    { concurrency: "unbounded" }
  );

  const loreIndexSourceMarkdown = [
    "# Rat Stack lore",
    "",
    "Short, source-grounded notes on the ideas and decisions behind rat-stack.",
    "",
    ...(["idea", "concept", "source", "person"] as const).flatMap((group) => {
      const pages = loreTexts.filter((lore) => lore.group === group);

      return pages.length === 0
        ? []
        : [
            `## ${group[0]?.toUpperCase()}${group.slice(1)}`,
            "",
            entryList(pages),
            "",
          ];
    }),
  ].join("\n");

  const systemsIndexSourceMarkdown = [
    "# Rat Stack systems",
    "",
    "Each shipped system has a page with its behavior, standard, and checks.",
    "",
    entryList(systemTexts),
    "",
    "The [interest signup](/systems/interest) page separates submission, confirmation, and delivery. [Devtools](/systems/devtools) stays development-only. The [hosted agent front door](/systems/agent-front-door) records discovery, MCP versions, API, A2A, and sandbox limits; extracting it into a generic cartridge remains future work.",
    "",
  ].join("\n");

  const groupedSkills = skillGroups
    .flatMap((group) => {
      const members = skillBodies.flatMap(({ skill }) =>
        group.names.some((name) => name === skill.name) ? [skill] : []
      );

      return members.length === 0
        ? []
        : [`### ${group.title}\n\n${entryList(members)}`];
    })
    .join("\n\n");

  const searchCapabilitySource = yield* readText(
    "apps/mischief/src/capabilities/search.ts"
  );

  const searchCapabilityExcerpt = searchCapabilitySource
    .split("\n")
    .slice(6)
    .join("\n")
    .trim();

  const homeMarkdownSource = `# Rat Stack

_${linkedTagline}_

Build an app and its cloud as one typed program. Our goal is the best Effect + Alchemy application we can build. Effect owns the hard parts. Alchemy infers the infrastructure from the code. The fence raises the floor so you can trust an agent's work.

Vendor it like a library. Keep the bins you need and pull the rest.

## Connect an agent

Paste this into your coding agent:

\`\`\`text
Read ${originToken}/llms.txt and use rat-stack as the reference
for how we build: Effect for the hard parts, Alchemy for the
infrastructure, and a fence that makes the easy path the right
one. Search its rules and skills before you write code, follow
its patterns, and tell me when my code breaks them.
\`\`\`

<CopyPrompt id="connect" />

Or connect the MCP server directly:

\`\`\`sh
# Claude Code
claude mcp add --transport http rat-stack ${originToken}/mcp

# Codex
codex mcp add rat-stack --url ${originToken}/mcp
\`\`\`

<CopyPrompt id="mcp" />

Cursor reads \`~/.cursor/mcp.json\`:

\`\`\`json
{ "mcpServers": { "rat-stack": { "url": "${originToken}/mcp" } } }
\`\`\`

<CopyPrompt id="cursor" />

Install the skills into any agent that reads a skills folder:

\`\`\`sh
npx skills add joelhooks/rat-stack
\`\`\`

<CopyPrompt id="skills" />

Supports MCP protocol versions 2026-07-28, 2025-11-25, 2025-06-18, 2025-03-26, and 2024-11-05. Clients on protocol 2026-07-28 are served without sessions; older clients get a session of their own, held by a Durable Object.

- [MCP connection details](${originToken}/.well-known/mcp.json)
- [HTTP API docs](${originToken}/openapi.json)
- [Short agent guide](${originToken}/llms.txt)
- [Public rules, lore, systems, and skills](${originToken}/llms-full.txt)
- [Lore wiki](${originToken}/lore)
- [Systems](${originToken}/systems)

## Four ideas

- **Pieces.** An Alchemy Layer carries its own infrastructure. A service tag is the product's API. A Layer is one vendor's implementation. Swapping vendors is a one-line change.
- **Trust.** Make the easy path the right path. The codebase and the compiler stop mistakes that rules and style guides can only ask about. Remove a binding and the code that uses it stops compiling.
- **Floor.** Raise the worst case. Small cuts to failure rates multiply how long an agent can run unattended.
- **Range.** Think wider. Building got fast and deploying did not. Layers that carry their own infrastructure close that gap. If it compiles, it deploys.

See the [vision](${originToken}/VISION.md) for the reasoning and sources.

## The shelf

These packages have separate jobs. Follow the removal checklists before cutting a bin; a package name alone does not prove one-line removal.

<Diagram alt="A shelf of current rat-stack bins: capability, core, database, auth, devtools, events, lore, subscriber-delivery, web, infra stack, and fence. The generic agent front door becoming its own cartridge is coming.">

\`\`\`text
  labeled · push in · pull out · self-contained · easy to trash

  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ capability │ │ core       │ │ database   │ │ auth       │
  │ contracts  │ │ handlers   │ │ D1 · PG    │ │ Better Auth│
  └────────────┘ └────────────┘ └────────────┘ └────────────┘

  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐
  │ devtools   │ │ web        │ │ infra      │ │ fence      │
  │ call logs  │ │ TanStack   │ │ Alchemy    │ │ types · CI │
  └────────────┘ └────────────┘ └────────────┘ └────────────┘
       in             in             in             in

  ┌────────────┐ ┌────────────┐ ┌─────────────────────┐
  │ events     │ │ lore       │ │ subscriber-delivery │
  │ analytics  │ │ graph      │ │ delivery adapter    │
  └────────────┘ └────────────┘ └─────────────────────┘

  ┌────────────┐
  │ front door │  coming: its own cartridge
  │ REST · MCP │
  │ A2A · code │
  └────────────┘
\`\`\`
</Diagram>

What to notice: these bins exist today. The hosted REST, MCP, A2A, and sandbox routes already run; extracting their generic front door into its own cartridge is coming.

[Hexagonal architecture](${originToken}/lore/hexagonal-architecture) keeps job-shaped ports in core and provider adapters outside it. [HATEOAS](${originToken}/lore/hateoas) explains links that guide an agent's next action, including agent-only page guidance. [Analytics](${originToken}/systems/analytics) is a running capture system; [interest signup](${originToken}/systems/interest) shows consent and confirmation across a delivery adapter.

## One capability, every surface

<Diagram alt="One capability projected to the command line, HTTP with OpenAPI, MCP tools, browser RPC, and sandbox code mode">

\`\`\`text
              ┌─────────────────────────────────────┐
              │  one contract + capability          │
              │  Effect Schema: input · output · err│
              │  one Effect handler                 │
              │  XState when the work has states    │
              └──────────────────┬──────────────────┘
                                 │  defineContract → implement
    ┌────────────┬────────────┬────────────┬────────────┬────────────┐
    ▼            ▼            ▼            ▼            ▼
  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐
  │ command  │ │   HTTP   │ │   MCP    │ │   RPC    │ │ sandbox  │
  │   line   │ │ + OpenAPI│ │  tools   │ │ browser  │ │ code mode│
  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘

  checked by  TypeScript 7 · Oxlint · Vitest · lefthook
  shipped by  pnpm · Turborepo · Alchemy → Cloudflare Worker
\`\`\`
</Diagram>

All five projections share one contract and handler. RPC serves the browser. Agents use MCP, HTTP, or the sandbox.

## The pattern in code

This is the whole search capability. Every surface below calls it.

\`\`\`ts
${searchCapabilityExcerpt}
\`\`\`

The schemas and handler share one contract across the command line, HTTP, MCP, browser RPC, and sandbox projections. RPC serves the browser. Agents use MCP, HTTP, or the sandbox.

## Learn the stack

Install these short guides for your agent with the command above, or read them here.

${groupedSkills}

These pieces are pre-release (Effect 4 rc, XState 6 alpha, TypeScript 7, Alchemy beta). APIs move; \`pins.md\` has the exact versions this repo builds against.

## Source files

${entryList(publicSpecs)}

`;

  const homeMarkdownAgentSource = deriveAgentMarkdown(homeMarkdownSource);

  const skillIndexSourceMarkdown = `# Learn the stack

These ${skillTexts.length} skills use a working app to teach the pieces inside it.

Install them:

\`npx skills add joelhooks/rat-stack\`

${groupedSkills}

Follow [ports and adapters](/lore/hexagonal-architecture) for provider boundaries and [agent next actions](/lore/hateoas) for hypermedia guidance. [Systems](/systems) shows the running behavior.
`;

  const homeBody = yield* compileMarkdownBody(
    homeMarkdownSource,
    "ratstack-home.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    "/"
  );

  const homeMarkdownTemplate = renderAgentPage(
    appendLoreMarkdown(
      withHouseAdPointer(homeMarkdownAgentSource, "/"),
      homeBody.linkedLoreRoutes
    ),
    "/",
    "rat-stack"
  );

  const noVerifyBody = yield* compileMarkdownBody(
    noVerifyMarkdown,
    "no-verify.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    trapRoutePath
  );

  const noVerifyAgentMarkdown = renderAgentPage(
    appendLoreMarkdown(noVerifyMarkdown, noVerifyBody.linkedLoreRoutes),
    trapRoutePath,
    "No verify"
  );

  const tokenmaxxSource = yield* readText("apps/mischief/content/tokenmaxx.md");

  const tokenmaxxBody = yield* compileMarkdownBody(
    tokenmaxxSource,
    "tokenmaxx.md",
    highlighter,
    emptyTargets,
    [],
    tokenmaxxRoutePath
  );

  const tokenmaxxAgentMarkdown = renderAgentPage(
    tokenmaxxSource,
    tokenmaxxRoutePath,
    "Tokenmaxx"
  );

  const authMarkdown = renderAgentPage(
    yield* readText("apps/mischief/content/auth.md"),
    "/auth.md",
    "ratstack.sh auth.md"
  );

  const tokenmaxxImageJpegBase64 = Buffer.from(
    yield* fileSystem
      .readFile(
        path.join(root, "apps/mischief/content/tokenmaxx/four-comma-club.jpg")
      )
      .pipe(
        Effect.mapError((cause) =>
          buildError(
            "read",
            "apps/mischief/content/tokenmaxx/four-comma-club.jpg",
            cause
          )
        )
      )
  ).toString("base64");

  const cartridgesImageJpegBase64 = Buffer.from(
    yield* fileSystem
      .readFile(
        path.join(
          root,
          "apps/mischief/content/tokenmaxx/snes-sfam-cartridges.jpg"
        )
      )
      .pipe(
        Effect.mapError((cause) =>
          buildError(
            "read",
            "apps/mischief/content/tokenmaxx/snes-sfam-cartridges.jpg",
            cause
          )
        )
      )
  ).toString("base64");

  const interestConfirmationEmail = yield* readText(
    "apps/mischief/content/tokenmaxx-confirmation-email.txt"
  );

  const skillIndexBody = yield* compileMarkdownBody(
    skillIndexSourceMarkdown,
    "ratstack-skills.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    "/skills"
  );

  const skillIndexMarkdown = renderAgentPage(
    appendLoreMarkdown(
      withHouseAdPointer(skillIndexSourceMarkdown, "/skills"),
      skillIndexBody.linkedLoreRoutes
    ),
    "/skills",
    "Learn the stack"
  );

  const loreIndexBody = yield* compileMarkdownBody(
    loreIndexSourceMarkdown,
    "ratstack-lore.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    "/lore"
  );

  const loreIndexMarkdown = renderAgentPage(
    withHouseAdPointer(loreIndexSourceMarkdown, "/lore"),
    "/lore",
    "Lore"
  );

  const systemsIndexBody = yield* compileMarkdownBody(
    systemsIndexSourceMarkdown,
    "ratstack-systems.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    "/systems"
  );

  const systemsIndexMarkdown = renderAgentPage(
    withHouseAdPointer(systemsIndexSourceMarkdown, "/systems"),
    "/systems",
    "Systems"
  );

  const glossaryPages = [
    ...loreTexts,
    ...skillTexts.map((skill) => ({
      description: skill.description,
      routePath: skill.routePath,
      terms: frontmatterTerms(skill.rawText, skill.sourcePath),
      title: skill.name,
    })),
  ];

  const glossaryTerms = glossaryEntries(
    glossaryPages,
    yield* readText("AGENTS.md")
  );

  assertGlossaryLinks(
    glossaryTerms,
    new Set(glossaryPages.map((page) => page.routePath))
  );
  const glossarySourceMarkdown = glossaryMarkdown(glossaryTerms);

  const glossaryIndexMarkdown = renderAgentPage(
    glossarySourceMarkdown,
    "/glossary",
    "Glossary"
  );

  const glossaryIndexBody = yield* compileMarkdownBody(
    glossarySourceMarkdown,
    "ratstack-glossary.md",
    highlighter,
    emptyTargets,
    [],
    "/glossary"
  );

  const llmsSourceMarkdown = [
    "# ratstack.sh",
    "",
    "Build an app and its cloud as one typed program with Effect and Alchemy. The fence makes the easy path the right one.",
    "",
    "## Read this repo",
    "",
    "- [Home](__RATSTACK_ORIGIN__/): short overview",
    "- [Glossary](__RATSTACK_ORIGIN__/glossary): A–Z terms, summaries, and pages",
    "- [Public content corpus](__RATSTACK_ORIGIN__/llms-full.txt): rules, lore, and skills in one response",
    "- [HTTP API](__RATSTACK_ORIGIN__/openapi.json): routes, inputs, outputs, and errors",
    "- [MCP server](__RATSTACK_ORIGIN__/mcp): tools for search, reading, and sandboxed code",
    "",
    agentNextActions(originToken),
    "## Source files",
    "",
    entryList(publicSpecs),
    "",
    loreIndexSourceMarkdown,
    "",
    systemsIndexSourceMarkdown,
    "",
    "## Skills",
    "",
    entryList(skillTexts),
  ].join("\n");

  const llmsBody = yield* compileMarkdownBody(
    llmsSourceMarkdown,
    "ratstack-llms.md",
    highlighter,
    emptyTargets,
    loreTermIndex,
    "/llms.txt"
  );

  const llmsLoreLinks = loreMarkdownLinks(llmsBody.linkedLoreRoutes);

  const knownRoutes = new Set([
    tokenmaxxRoutePath,
    "/lore/cartridges/snes-sfam-cartridges.jpg",
    "/glossary",
    "/og/glossary.png",
    "/",
    "/skills",
    "/lore",
    "/systems",
    "/auth.md",
    "/llms.txt",
    "/llms-full.txt",
    "/openapi.json",
    "/mcp",
    "/api/search",
    "/api/read",
    "/api/execute",
    "/a2a",
    "/robots.txt",
    "/sitemap.xml",
    "/favicon.svg",
    "/favicon.ico",
    "/apple-touch-icon.png",
    "/.well-known/agent-card.json",
    "/.well-known/agent.json",
    "/.well-known/agent-skills/index.json",
    "/.well-known/ai-catalog.json",
    "/.well-known/api-catalog",
    "/.well-known/mcp.json",
    "/.well-known/http-message-signatures-directory",
    "/no-verify",
    trapRoutePath,
    tokenmaxxRoutePath,
    ...publicSpecs.map((spec) => spec.routePath),
    ...skillTexts.flatMap((skill) => [
      skill.routePath,
      `/.well-known/agent-skills/${skill.name}/SKILL.md`,
    ]),
    ...loreTexts.map((lore) => lore.routePath),
    ...[
      "/",
      "/skills",
      "/lore",
      "/systems",
      trapRoutePath,
      ...publicSpecs.map((spec) => spec.routePath),
      ...skillTexts.map((skill) => skill.routePath),
      ...loreTexts.map((lore) => lore.routePath),
    ].map(ogImagePath),
  ]);

  const documentsToCheck = [
    {
      pageRoute: "/glossary",
      sourcePath: "ratstack-glossary.md",
      text: glossarySourceMarkdown,
    },
    {
      pageRoute: "/",
      sourcePath: "apps/mischief/src/document.svelte",
      text: shellSource,
    },
    {
      pageRoute: "/",
      sourcePath: "ratstack-home.md",
      text: `${homeMarkdownSource}\n${homeMarkdownTemplate}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
    {
      pageRoute: "/skills",
      sourcePath: "ratstack-skills.md",
      text: `${skillIndexSourceMarkdown}\n${skillIndexMarkdown}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
    {
      pageRoute: "/lore",
      sourcePath: "ratstack-lore.md",
      text: `${loreIndexSourceMarkdown}\n${loreIndexMarkdown}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
    {
      pageRoute: "/systems",
      sourcePath: "ratstack-systems.md",
      text: systemsIndexSourceMarkdown.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
    ...lawBodies.map(({ spec }) => ({
      pageRoute: spec.routePath,
      sourcePath: spec.sourcePath,
      text: `${spec.rawText}\n${spec.text}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    })),
    ...skillBodies.map(({ skill }) => ({
      pageRoute: skill.routePath,
      sourcePath: skill.sourcePath,
      text: `${skill.rawText}\n${skill.text}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    })),
    ...loreBodies.map(({ lore }) => ({
      pageRoute: lore.routePath,
      sourcePath: lore.sourcePath,
      text: `${lore.rawText}\n${lore.text}\n${lore.sources.map((source) => `<a href="${escapeHtml(source)}">`).join("\n")}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    })),
    {
      pageRoute: trapRoutePath,
      sourcePath: "no-verify.md",
      text: `${noVerifyMarkdown}\n${noVerifyAgentMarkdown}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
    {
      pageRoute: "/llms.txt",
      sourcePath: "ratstack-llms.md",
      text: `${llmsSourceMarkdown}\n${llmsLoreLinks}`.replaceAll(
        originToken,
        "https://ratstack.sh"
      ),
    },
  ];

  for (const document of documentsToCheck) {
    validateInternalLinks({ ...document, knownRoutes });
  }

  const wovenPages = [
    {
      routePath: "/",
      routes: homeBody.linkedLoreRoutes,
      sourcePath: "ratstack-home.md",
      text: homeMarkdownSource,
      wovenLinks: homeBody.linkedLoreTerms,
    },
    {
      routePath: trapRoutePath,
      routes: noVerifyBody.linkedLoreRoutes,
      sourcePath: "no-verify.md",
      text: noVerifyMarkdown,
      wovenLinks: noVerifyBody.linkedLoreTerms,
    },
    {
      routePath: "/skills",
      routes: skillIndexBody.linkedLoreRoutes,
      sourcePath: "ratstack-skills.md",
      text: skillIndexSourceMarkdown,
      wovenLinks: skillIndexBody.linkedLoreTerms,
    },
    {
      routePath: "/lore",
      routes: loreIndexBody.linkedLoreRoutes,
      sourcePath: "ratstack-lore.md",
      text: loreIndexSourceMarkdown,
      wovenLinks: loreIndexBody.linkedLoreTerms,
    },
    {
      routePath: "/systems",
      routes: systemsIndexBody.linkedLoreRoutes,
      sourcePath: "ratstack-systems.md",
      text: systemsIndexSourceMarkdown,
      wovenLinks: systemsIndexBody.linkedLoreTerms,
    },
    {
      routePath: "/llms.txt",
      routes: llmsBody.linkedLoreRoutes,
      sourcePath: "ratstack-llms.md",
      text: llmsSourceMarkdown,
      wovenLinks: llmsBody.linkedLoreTerms,
    },
    ...lawBodies.map(({ linkedLoreRoutes, linkedLoreTerms, spec }) => ({
      routePath: spec.routePath,
      routes: linkedLoreRoutes,
      sourcePath: spec.sourcePath,
      text: spec.rawText,
      wovenLinks: linkedLoreTerms,
    })),
    ...skillBodies.map(({ linkedLoreRoutes, linkedLoreTerms, skill }) => ({
      routePath: skill.routePath,
      routes: linkedLoreRoutes,
      sourcePath: skill.sourcePath,
      text: skill.rawText,
      wovenLinks: linkedLoreTerms,
    })),
    ...loreBodies.map(({ linkedLoreRoutes, linkedLoreTerms, lore }) => ({
      routePath: lore.routePath,
      routes: linkedLoreRoutes,
      sourcePath: lore.sourcePath,
      text: lore.rawText,
      wovenLinks: linkedLoreTerms,
    })),
  ];

  assertWovenLoreRoutes(wovenPages, knownRoutes);

  const recordPageLinks = (
    route: string,
    sourcePath: string,
    markdown: string,
    wovenRoutes: ReadonlySet<string>
  ) => {
    recordLoreRoutes(route, wovenRoutes);
    recordLoreRoutes(route, loreLinkTargets(sourcePath, markdown, loreRoutes));
    recordLoreRoutes(
      route,
      extractBlockReferences(markdown).map((ref) => ref.page)
    );
  };

  recordPageLinks(
    "/",
    "ratstack-home.md",
    homeMarkdownSource,
    homeBody.linkedLoreRoutes
  );
  recordPageLinks(
    trapRoutePath,
    "no-verify.md",
    noVerifyMarkdown,
    noVerifyBody.linkedLoreRoutes
  );
  recordPageLinks(
    "/skills",
    "ratstack-skills.md",
    skillIndexSourceMarkdown,
    skillIndexBody.linkedLoreRoutes
  );
  recordPageLinks(
    "/lore",
    "ratstack-lore.md",
    loreIndexSourceMarkdown,
    loreIndexBody.linkedLoreRoutes
  );
  recordPageLinks(
    "/systems",
    "ratstack-systems.md",
    systemsIndexSourceMarkdown,
    systemsIndexBody.linkedLoreRoutes
  );

  for (const { spec, linkedLoreRoutes } of lawBodies) {
    recordPageLinks(
      spec.routePath,
      spec.sourcePath,
      spec.rawText,
      linkedLoreRoutes
    );
  }

  for (const { skill, linkedLoreRoutes } of skillBodies) {
    recordPageLinks(
      skill.routePath,
      skill.sourcePath,
      skill.rawText,
      linkedLoreRoutes
    );
  }

  for (const { lore, linkedLoreRoutes } of loreBodies) {
    recordPageLinks(
      lore.routePath,
      lore.sourcePath,
      lore.rawText,
      linkedLoreRoutes
    );
  }

  recordPageLinks(
    "/llms.txt",
    "ratstack-llms.md",
    llmsSourceMarkdown,
    llmsBody.linkedLoreRoutes
  );
  recordLoreRoutes(
    "/llms-full.txt",
    loreTexts.map((lore) => lore.routePath)
  );

  const loreByRoute = new Map<string, (typeof loreTexts)[number]>(
    loreTexts.map((lore) => [lore.routePath, lore])
  );

  const graphPages: LoreBuildPage[] = [
    ...wovenPages.map((page) => {
      const lore = loreByRoute.get(page.routePath);

      const sourcePage = {
        group: pageKinds.get(page.routePath) ?? "Page",
        id: page.routePath,
        routePath: page.routePath,
        text: page.text,
        title: titles.get(page.routePath) ?? page.routePath,
        url: `https://ratstack.sh${page.routePath}`,
        wovenLinks: page.wovenLinks,
      };

      if (lore === undefined) {
        return sourcePage;
      }

      const loreMetadata = {
        description: lore.description,
        group: lore.group,
        slug: lore.slug,
        sources: lore.sources,
        terms: lore.terms,
      };

      if (lore.url === undefined) {
        return { ...sourcePage, lore: loreMetadata };
      }

      return {
        ...sourcePage,
        lore: { ...loreMetadata, sourceUrl: lore.url },
      };
    }),
    {
      group: pageKinds.get("/llms-full.txt") ?? "Page",
      id: "/llms-full.txt",
      routePath: "/llms-full.txt",
      text: "",
      title: titles.get("/llms-full.txt") ?? "Full agent guide",
      url: "https://ratstack.sh/llms-full.txt",
    },
  ];

  const loreGraphSnapshot = yield* Schema.decodeEffect(LoreGraphSnapshotSchema)(
    buildLoreGraph({
      links: [...linkTargetsBySource].flatMap(([from, targets]) =>
        [...targets].map((to) => ({ from, to }))
      ),
      pages: graphPages,
    })
  );

  const loreGraphSnapshotJson = yield* Schema.decodeUnknownEffect(Schema.Json)(
    loreGraphSnapshot
  );

  const homeMetadata = {
    description:
      "The reference for building an app and its cloud as one typed program, with Effect, Alchemy, and a fence that raises the floor.",
    path: "/",
    title: "Rat Stack: an app and its cloud as one typed program",
  } as const;

  const skillIndexMetadata = {
    description:
      "Hands-on guides to Effect actions, XState lifecycles, and the seams between stack pieces.",
    path: "/skills",
    title: "Learn the stack | rat-stack",
  } as const;

  const loreIndexMetadata = {
    description:
      "Short, source-grounded notes on the ideas and decisions behind rat-stack.",
    path: "/lore",
    title: "Rat Stack lore | rat-stack",
  } as const;

  const systemsIndexMetadata = {
    description:
      "The systems rat-stack ships, the standard each keeps, and how to check it.",
    path: "/systems",
    title: "Rat Stack systems | rat-stack",
  } as const;

  const noVerifyMetadata = {
    description: "The rat looks disappointed. The hook still runs.",
    path: trapRoutePath,
    title: "No verify | rat-stack",
  } as const;

  const backlinkPages = [
    {
      bodyHtml: homeBody.bodyHtml,
      description: tagline,
      route: "/",
      title: "rat-stack",
    },
    {
      bodyHtml: noVerifyBody.bodyHtml,
      description: noVerifyMetadata.description,
      route: trapRoutePath,
      title: noVerifyMetadata.title,
    },
    {
      bodyHtml: skillIndexBody.bodyHtml,
      description: skillIndexMetadata.description,
      route: "/skills",
      title: skillIndexMetadata.title,
    },
    {
      bodyHtml: loreIndexBody.bodyHtml,
      description: loreIndexMetadata.description,
      route: "/lore",
      title: loreIndexMetadata.title,
    },
    {
      bodyHtml: systemsIndexBody.bodyHtml,
      description: systemsIndexMetadata.description,
      route: "/systems",
      title: systemsIndexMetadata.title,
    },
    {
      bodyHtml: llmsBody.bodyHtml,
      description: tagline,
      route: "/llms.txt",
      title: "Agent guide",
    },
    {
      bodyHtml: "",
      description: tagline,
      route: "/llms-full.txt",
      title: "Full agent guide",
    },
    ...lawBodies.map(({ spec, bodyHtml }) => ({
      bodyHtml,
      description: spec.description,
      route: spec.routePath,
      title: spec.title,
    })),
    ...skillBodies.map(({ skill, bodyHtml }) => ({
      bodyHtml,
      description: skill.description,
      route: skill.routePath,
      title: skill.name,
    })),
    ...loreBodies.map(({ lore, bodyHtml }) => ({
      bodyHtml,
      description: lore.description,
      route: lore.routePath,
      title: lore.title,
    })),
  ];

  const mentionPages = [
    { prose: homeBody.unlinkedProse, route: "/", title: "rat-stack" },
    {
      prose: noVerifyBody.unlinkedProse,
      route: trapRoutePath,
      title: noVerifyMetadata.title,
    },
    ...lawBodies.map(({ spec, unlinkedProse }) => ({
      prose: unlinkedProse,
      route: spec.routePath,
      title: spec.title,
    })),
    ...skillBodies.map(({ skill, unlinkedProse }) => ({
      prose: unlinkedProse,
      route: skill.routePath,
      title: skill.name,
    })),
    ...loreBodies.map(({ lore, unlinkedProse }) => ({
      prose: unlinkedProse,
      route: lore.routePath,
      title: lore.title,
    })),
  ];

  const unlinkedMentions = findUnlinkedMentions(mentionPages, glossaryTerms);
  const unlinkedMentionsPath = ".brain/data/unlinked-mentions.generated.json";

  yield* writeFileAtomically(
    path.join(root, unlinkedMentionsPath),
    `${JSON.stringify(unlinkedMentions, null, 2)}\n`
  ).pipe(
    Effect.mapError((cause) =>
      buildError("unlinked mentions report", unlinkedMentionsPath, cause)
    )
  );

  const backlinkIndex = buildBacklinkIndex(
    backlinkPages,
    loreGraphSnapshot.edges
      .filter((edge) => edge.kind === "link")
      .map((edge) => ({
        from: edge.from.url.slice("https://ratstack.sh".length),
        to: edge.to.url.slice("https://ratstack.sh".length),
      }))
  );

  const makeDocument = (
    bodyHtml: string,
    metadata: Omit<
      DocumentProps,
      "bodyHtml" | "discoveryLinks" | "ogImageUrl" | "origin" | "stylesheet"
    >,
    sourcePath: string,
    contentVersion: string
  ) =>
    renderDocument(
      shell,
      {
        bodyHtml: addInboundCounts(bodyHtml, metadata.path, backlinkIndex),
        discoveryLinks: markdownDiscoveryLinks(metadata.path),
        houseAdHtml: hasHouseAd(metadata.path) ? houseAdHtml : "",
        ogImageUrl: `${originToken}${ogImagePath(metadata.path)}?v=${contentVersion}`,
        origin: originToken,
        stylesheet,
        ...metadata,
      },
      sourcePath
    );

  const publishedMentions = yield* Schema.decodeEffect(UnlinkedMentionsSchema)(
    unlinkedMentions
  );

  const unlinkedByTarget = groupUnlinkedMentions(publishedMentions);

  const referenceRegistry = createComponentRegistry({
    LinkedFrom: linkedFromComponent(backlinkIndex),
    UnlinkedMentions: unlinkedMentionsComponent(unlinkedByTarget),
  });

  const referenceSource = (route: string) =>
    `<LinkedFrom page="${escapeHtml(route)}" />\n\n<UnlinkedMentions page="${escapeHtml(route)}" />`;

  const pageFooterMarkdown = (route: string) => {
    const markdown = renderSvxMarkdown(
      referenceSource(route),
      "agent",
      { pagePath: route },
      referenceRegistry
    );

    return markdown === "" ? "" : `\n\n${markdown}`;
  };

  const pageFooterHtml = (route: string, sourcePath: string) => {
    const lines: string[] = [];
    const change = lastChanges.get(sourcePath);

    if (change !== undefined) {
      lines.push(
        `<p>Last changed ${change.date} in <a href="${repoUrl}/commit/${change.hash}">${change.short}</a>. <a href="${repoUrl}/blob/main/${sourcePath}">Source on GitHub</a>. <a href="/log">Change log</a>.</p>`
      );
    }

    lines.push(
      renderSvxMarkdown(
        referenceSource(route),
        "human",
        { pagePath: route, sourcePath },
        referenceRegistry
      ).trim()
    );

    return lines.length === 0 ? "" : `<hr>${lines.join("")}`;
  };

  const lawBodiesWithFooters = lawBodies.map(({ bodyHtml, spec }) => ({
    bodyHtml: `${bodyHtml}${pageFooterHtml(spec.routePath, spec.sourcePath)}`,
    spec,
  }));

  const skillBodiesWithFooters = skillBodies.map(({ bodyHtml, skill }) => ({
    bodyHtml: `${bodyHtml}${pageFooterHtml(skill.routePath, skill.sourcePath)}`,
    skill,
  }));

  const loreBodiesWithFooters = loreBodies.map(({ bodyHtml, lore }) => ({
    bodyHtml: `${bodyHtml}${pageFooterHtml(lore.routePath, lore.sourcePath)}`,
    lore,
  }));

  const noVerifyBodyHtml = `${noVerifyBody.bodyHtml}${pageFooterHtml(
    trapRoutePath,
    "no-verify.md"
  )}`;

  const tokenmaxxBodyHtml = `${tokenmaxxBody.bodyHtml}__COPY_SCRIPT__`;

  const skillIndexBodyHtml = `${skillIndexBody.bodyHtml}${pageFooterHtml(
    "/skills",
    "ratstack-skills.md"
  )}`;

  const loreIndexBodyHtml = `${loreIndexBody.bodyHtml}${pageFooterHtml(
    "/lore",
    "ratstack-lore.md"
  )}`;

  const systemsIndexBodyHtml = `${systemsIndexBody.bodyHtml}${pageFooterHtml(
    "/systems",
    "ratstack-systems.md"
  )}`;

  const homeBodyHtml = homeBody.bodyHtml;

  const staticSourcePathGroups = yield* Effect.forEach(
    ["apps/mischief/src", "packages/capability/src"],
    (directory) =>
      fileSystem
        .readDirectory(path.join(root, directory), { recursive: true })
        .pipe(
          Effect.map((relativePaths) =>
            relativePaths
              .filter(
                (relativePath) =>
                  (relativePath.endsWith(".ts") ||
                    relativePath.endsWith(".svelte")) &&
                  !relativePath.endsWith(".generated.ts")
              )
              .map((relativePath) => `${directory}/${relativePath}`)
          ),
          Effect.mapError((cause) =>
            buildError("read directory", directory, cause)
          )
        ),
    { concurrency: "unbounded" }
  );

  const staticSourcePaths = staticSourcePathGroups.flat().toSorted();

  const staticSourceText = yield* Effect.forEach(staticSourcePaths, readText, {
    concurrency: "unbounded",
  });

  const contentVersion = digest(
    [
      homeMarkdownTemplate,
      homeBodyHtml,
      noVerifyAgentMarkdown,
      noVerifyBodyHtml,
      tokenmaxxAgentMarkdown,
      tokenmaxxBodyHtml,
      interestResultBody,
      interestConfirmBody,
      unsubscribeBody,
      tokenmaxxImageJpegBase64,
      cartridgesImageJpegBase64,
      skillIndexMarkdown,
      skillIndexBodyHtml,
      loreIndexMarkdown,
      loreIndexBodyHtml,
      systemsIndexMarkdown,
      systemsIndexBodyHtml,
      glossaryIndexMarkdown,
      glossaryIndexBody.bodyHtml,
      llmsLoreLinks,
      emojiSvg,
      stylesheet,
      ...publicSpecs.map((spec) => spec.text),
      ...lawBodiesWithFooters.map(({ bodyHtml }) => bodyHtml),
      ...skillTexts.map((skill) => skill.text),
      ...skillBodiesWithFooters.map(({ bodyHtml }) => bodyHtml),
      ...loreTexts.map((lore) => lore.text),
      ...loreBodiesWithFooters.map(({ bodyHtml }) => bodyHtml),
      ...staticSourceText,
    ].join("\u0000")
  ).slice(0, 16);

  const tokenmaxxMetadata = {
    description:
      "Loopcraft: the outer loop. A four-hour working session building agent harnesses.",
    noindex: true,
    path: tokenmaxxRoutePath,
    title: "how to burn a trillion tokens and get good results",
  } as const;

  const interestPageMetadata = {
    description: tokenmaxxMetadata.description,
    noindex: true,
    path: tokenmaxxRoutePath,
    title: "Workshop interest | rat-stack",
  } as const;

  const glossaryIndexMetadata = {
    description:
      "An A–Z index of terms, with summaries and links to lore, systems, and skills.",
    path: "/glossary",
    title: "Glossary | rat-stack",
  } as const;

  const ogPages: readonly OgPage[] = [
    {
      description: glossaryIndexMetadata.description,
      routePath: "/glossary",
      title: "Glossary",
    },
    {
      description: tokenmaxxMetadata.description,
      routePath: tokenmaxxRoutePath,
      title: tokenmaxxMetadata.title,
    },
    {
      description: tagline,
      routePath: "/",
      title: "ratstack.sh",
    },
    {
      description: noVerifyMetadata.description,
      routePath: trapRoutePath,
      title: "No verify",
    },
    {
      description: skillIndexMetadata.description,
      routePath: "/skills",
      title: "Learn the stack",
    },
    {
      description: loreIndexMetadata.description,
      routePath: "/lore",
      title: "Rat Stack lore",
    },
    {
      description: systemsIndexMetadata.description,
      routePath: "/systems",
      title: "Rat Stack systems",
    },
    ...publicSpecs.map(({ description, routePath, title }) => ({
      description,
      routePath,
      title,
    })),
    ...skillTexts.map(({ description, name, routePath }) => ({
      description,
      routePath,
      title: name,
    })),
    ...loreTexts.map(({ description, routePath, title }) => ({
      description,
      routePath,
      title,
    })),
  ];

  const ogImages = yield* Effect.forEach(
    ogPages,
    (page) =>
      renderOgImage(
        page,
        emojiSvg,
        Buffer.from(regularFont),
        Buffer.from(boldFont)
      ).pipe(
        Effect.map((png) => ({
          pngBase64: Buffer.from(png).toString("base64"),
          routePath: page.routePath,
        }))
      ),
    { concurrency: 4 }
  );

  const faviconIcoBase64 = Buffer.from(
    encodeIco(
      yield* Effect.forEach([16, 32, 48], (size) =>
        renderRatPng(emojiSvg, size).pipe(
          Effect.map((bytes) => ({ bytes: new Uint8Array(bytes), size }))
        )
      )
    )
  ).toString("base64");

  const appleTouchIconPngBase64 = Buffer.from(
    yield* renderRatPng(emojiSvg, 180, "white")
  ).toString("base64");

  const lawSources = yield* Effect.forEach(
    lawBodiesWithFooters,
    ({ bodyHtml, spec }) =>
      Effect.gen(function* renderPublic() {
        const documentHtml = yield* makeDocument(
          bodyHtml,
          {
            breadcrumbHref: "/",
            breadcrumbLabel: "source files",
            breadcrumbName: spec.title,
            contentDates: contentDates(spec.rawText, spec.sourcePath),
            description: spec.description,
            path: spec.routePath,
            title: pageTitle(spec.title),
          },
          spec.sourcePath,
          contentVersion
        );

        const bodyMarkdown = deriveAgentMarkdown(
          `${spec.text}${pageFooterMarkdown(spec.routePath)}`
        );

        const text = renderAgentPage(bodyMarkdown, spec.routePath, spec.title);

        return {
          ...contentDates(spec.rawText, spec.sourcePath),
          bodyMarkdown,
          description: spec.description,
          digest: digest(text),
          documentHtml,
          routePath: spec.routePath,
          sourcePath: spec.sourcePath,
          text,
          title: spec.title,
        };
      }),
    { concurrency: "unbounded" }
  );

  const skillSources = yield* Effect.forEach(
    skillBodiesWithFooters,
    ({ bodyHtml, skill }) =>
      Effect.gen(function* renderSkill() {
        const documentHtml = yield* makeDocument(
          bodyHtml,
          {
            breadcrumbHref: "/skills",
            breadcrumbLabel: "skills",
            breadcrumbName: skill.name,
            contentDates: contentDates(skill.rawText, skill.sourcePath),
            description: skill.description,
            path: skill.routePath,
            title: pageTitle(skill.name),
          },
          skill.sourcePath,
          contentVersion
        );

        const bodyMarkdown = deriveAgentMarkdown(
          withHouseAdPointer(
            `${skill.text}${pageFooterMarkdown(skill.routePath)}`,
            skill.routePath
          )
        );

        const text = renderAgentPage(bodyMarkdown, skill.routePath, skill.name);

        return {
          ...contentDates(skill.rawText, skill.sourcePath),
          bodyMarkdown,
          description: skill.description,
          digest: digest(text),
          documentHtml,
          name: skill.name,
          routePath: skill.routePath,
          sourcePath: skill.sourcePath,
          text,
        };
      }),
    { concurrency: "unbounded" }
  );

  const loreSources = yield* Effect.forEach(
    loreBodiesWithFooters,
    ({ bodyHtml, lore }) =>
      Effect.gen(function* renderLorePage() {
        const documentHtml = yield* makeDocument(
          bodyHtml,
          {
            breadcrumbHref: sectionOf(lore.group).href,
            breadcrumbLabel: sectionOf(lore.group).label,
            breadcrumbName: lore.title,
            contentDates: contentDates(lore.rawText, lore.sourcePath),
            description: lore.description,
            path: lore.routePath,
            title: pageTitle(lore.title),
          },
          lore.sourcePath,
          contentVersion
        );

        const bodyMarkdown = deriveAgentMarkdown(
          withHouseAdPointer(
            `${lore.text}${pageFooterMarkdown(lore.routePath)}`,
            lore.routePath
          )
        );

        const text = renderAgentPage(bodyMarkdown, lore.routePath, lore.title);

        return {
          ...contentDates(lore.rawText, lore.sourcePath),
          bodyMarkdown,
          description: lore.description,
          digest: digest(text),
          documentHtml,
          group: lore.group,
          routePath: lore.routePath,
          slug: lore.slug,
          sourcePath: lore.sourcePath,
          sources: lore.sources,
          terms: lore.terms,
          text,
          title: lore.title,
        };
      }),
    { concurrency: "unbounded" }
  );

  const errorPageMarkdown = yield* readText(
    "apps/mischief/content/error-page.md"
  );

  const errorActionsMarkdown =
    "- [Home](/)\n- [Glossary](/glossary)\n- [Lore](/lore)\n- [Systems](/systems)\n- [Change log](/log)\n- [Agent guide](/llms.txt)\n";

  const errorSuggestionMarkdown =
    "1. [ERROR_LINK_TITLE](ERROR_LINK_PATH) — ERROR_LINK_DESCRIPTION\n";

  const errorBody = yield* compileMarkdownBody(
    errorPageMarkdown,
    "error-page.md",
    highlighter,
    emptyTargets,
    [],
    "/error"
  );

  const errorActions = yield* compileMarkdownBody(
    errorActionsMarkdown,
    "error-actions.md",
    highlighter,
    emptyTargets,
    [],
    "/error"
  );

  const errorSuggestion = yield* compileMarkdownBody(
    errorSuggestionMarkdown,
    "error-suggestion.md",
    highlighter,
    emptyTargets,
    [],
    "/error"
  );

  const noVerifyErrorDetails = {
    html: noVerifyBody.bodyHtml,
    markdown: noVerifyAgentMarkdown,
  };

  const errorPageDocumentHtml = yield* renderDocument(
    shell,
    {
      bodyHtml: errorBody.bodyHtml.replaceAll(
        "ERROR_CODE ERROR_TITLE</h1>",
        '<span class="error-code">ERROR_CODE</span> ERROR_TITLE</h1>'
      ),
      description: "ERROR_MESSAGE",
      discoveryLinks: markdownDiscoveryLinks("/"),
      noindex: true,
      ogImageUrl: `${originToken}/og/home.png`,
      origin: originToken,
      path: "/",
      stylesheet,
      title: "ERROR_CODE ERROR_TITLE | rat-stack",
    },
    "error-page.md"
  );

  const homeDocumentHtml = yield* makeDocument(
    homeBodyHtml,
    homeMetadata,
    "ratstack-home.md",
    contentVersion
  );

  const skillIndexDocumentHtml = yield* makeDocument(
    skillIndexBodyHtml,
    skillIndexMetadata,
    "ratstack-skills.md",
    contentVersion
  );

  const loreIndexDocumentHtml = yield* makeDocument(
    loreIndexBodyHtml,
    loreIndexMetadata,
    "ratstack-lore.md",
    contentVersion
  );

  const systemsIndexDocumentHtml = yield* makeDocument(
    systemsIndexBodyHtml,
    systemsIndexMetadata,
    "ratstack-systems.md",
    contentVersion
  );

  const noVerifyDocumentHtml = yield* makeDocument(
    noVerifyBodyHtml,
    noVerifyMetadata,
    "no-verify.md",
    contentVersion
  );

  const tokenmaxxDocumentHtml = yield* makeDocument(
    tokenmaxxBodyHtml,
    tokenmaxxMetadata,
    "tokenmaxx.md",
    contentVersion
  );

  const unsubscribeDocumentHtml = yield* renderDocument(
    shell,
    {
      bodyHtml: unsubscribeBody,
      description: "Stop getting emails about the Rat Stack workshop?",
      discoveryLinks: [],
      noindex: true,
      ogImageUrl: `${originToken}/og/home.png`,
      origin: originToken,
      path: "/tokenmaxx/unsubscribe",
      stylesheet,
      title: "Unsubscribe",
    },
    "tokenmaxx-unsubscribe.html"
  );

  const interestResultDocumentHtml = yield* makeDocument(
    interestResultBody,
    interestPageMetadata,
    "tokenmaxx-interest-result.html",
    contentVersion
  );

  const interestConfirmDocumentHtml = yield* makeDocument(
    interestConfirmBody,
    interestPageMetadata,
    "tokenmaxx-interest-confirm.html",
    contentVersion
  );

  const glossaryIndexDocumentHtml = yield* makeDocument(
    glossaryIndexBody.bodyHtml,
    glossaryIndexMetadata,
    "ratstack-glossary.md",
    contentVersion
  );

  const staticContentVersion = contentVersion;

  const resources = normalizeSources({ lawSources, loreSources, skillSources });

  const contentData = [
    {
      path: "/_content/catalog.json",
      value: {
        glossaryIndexMarkdown,
        glossaryTerms: glossaryTerms.map(({ term, summary, routePath }) => ({
          routePath,
          summary,
          term,
        })),
        homeMarkdownTemplate: `${homeMarkdownTemplate}${pageFooterMarkdown("/")}`,
        imagePaths: [
          ...ogImages.map((image) => ogImagePath(image.routePath)),
          "/favicon.ico",
          "/apple-touch-icon.png",
          "/favicon.svg",
          "/tokenmaxx/four-comma-club.jpg",
          "/lore/cartridges/snes-sfam-cartridges.jpg",
        ],
        llmsLoreLinks,
        loreIndexMarkdown: `${loreIndexMarkdown}${pageFooterMarkdown("/lore")}`,
        pageRoutes: [
          ...resources.map((resource) => resource.routePath),
          "/",
          "/lore",
          "/systems",
          "/skills",
          "/glossary",
        ],
        resources: resources.map(
          ({ bodyMarkdown: _bodyMarkdown, text: _text, ...metadata }) =>
            metadata
        ),
        skillIndexMarkdown: `${skillIndexMarkdown}${pageFooterMarkdown("/skills")}`,
        systemsIndexMarkdown: `${systemsIndexMarkdown}${pageFooterMarkdown("/systems")}`,
      },
    },
    {
      path: "/_content/search.json",
      value: resources.map(
        ({ bodyMarkdown: _bodyMarkdown, ...resource }) => resource
      ),
    },
    { path: "/_content/graph.json", value: loreGraphSnapshotJson },
    ...resources.map((resource) => ({
      path: contentPagePath(resource.id),
      value: resource,
    })),
  ];

  const data = yield* Schema.decodeUnknownEffect(
    Schema.Array(
      Schema.Struct({
        path: Schema.String,
        value: Schema.Json,
      })
    )
  )(contentData);

  const assetManifest = yield* emitAssets({
    data,
    directory: path.join(root, "apps/mischief/dist/content"),
    images: [
      { base64: faviconIcoBase64, path: "/favicon.ico" },
      { base64: appleTouchIconPngBase64, path: "/apple-touch-icon.png" },
      {
        base64: Buffer.from(emojiSvg).toString("base64"),
        path: "/favicon.svg",
      },
      ...ogImages.map((image) => ({
        base64: image.pngBase64,
        path: ogImagePath(image.routePath),
      })),
      {
        base64: tokenmaxxImageJpegBase64,
        path: "/tokenmaxx/four-comma-club.jpg",
      },
      {
        base64: cartridgesImageJpegBase64,
        path: "/lore/cartridges/snes-sfam-cartridges.jpg",
      },
    ],
    pages: [
      ...lawSources,
      ...loreSources,
      ...skillSources,
      {
        documentHtml: `${homeDocumentHtml}<script>${copyScript}</script>`,
        routePath: "/",
        text: `${homeMarkdownTemplate}${pageFooterMarkdown("/")}`,
      },
      {
        documentHtml: loreIndexDocumentHtml,
        routePath: "/lore",
        text: `${loreIndexMarkdown}${pageFooterMarkdown("/lore")}`,
      },
      {
        documentHtml: systemsIndexDocumentHtml,
        routePath: "/systems",
        text: `${systemsIndexMarkdown}${pageFooterMarkdown("/systems")}`,
      },
      {
        documentHtml: skillIndexDocumentHtml,
        routePath: "/skills",
        text: `${skillIndexMarkdown}${pageFooterMarkdown("/skills")}`,
      },
      {
        documentHtml: glossaryIndexDocumentHtml,
        routePath: "/glossary",
        text: glossaryIndexMarkdown,
      },
    ],
  });

  const readerSourcePath = path.join(
    root,
    "apps/mischief/dist/reader-source.json"
  );

  yield* fileSystem
    .writeFileString(
      readerSourcePath,
      JSON.stringify({
        generation: assetManifest.generation,
        home: homeMarkdownSource,
      })
    )
    .pipe(
      Effect.mapError((cause) =>
        buildError("write reader source", readerSourcePath, cause)
      )
    );

  const generated = `// Generated by scripts/generate-content.ts. Do not edit by hand.\n\nexport const originToken = ${sourceLiteral(originToken)} as const;\n\nexport const agentPointerMarkdown = ${sourceLiteral(agentPointerMarkdown)} as const;\n\nexport const authMarkdown = ${sourceLiteral(authMarkdown)} as const;\n\nexport const staticContentVersion = ${sourceLiteral(staticContentVersion)} as const;\n\nexport const ogImagePath = (routePath: string) => "/og" + (routePath === "/" ? "/home" : routePath) + ".png";\n\nexport const staticAssetGeneration = ${sourceLiteral(assetManifest.generation)} as const;\n\nexport const noVerifyMarkdown = ${sourceLiteral(`${noVerifyAgentMarkdown}${pageFooterMarkdown(trapRoutePath)}`)} as const;\n\nexport const noVerifyDocumentHtml = ${sourceLiteral(noVerifyDocumentHtml)} as const;\n\nexport const tokenmaxxCopyScript = ${sourceLiteral(copyScript)} as const;\n\nexport const tokenmaxxCopyScriptHash = ${sourceLiteral(copyScriptHash)} as const;\n\nexport const tokenmaxxMarkdown = ${sourceLiteral(tokenmaxxAgentMarkdown)} as const;\n\nexport const tokenmaxxDocumentHtml = ${sourceLiteral(tokenmaxxDocumentHtml)} as const;\n\nexport const unsubscribeDocumentHtml = ${sourceLiteral(unsubscribeDocumentHtml)} as const;\n\nexport const interestResultDocumentHtml = ${sourceLiteral(interestResultDocumentHtml)} as const;\n\nexport const interestConfirmDocumentHtml = ${sourceLiteral(interestConfirmDocumentHtml)} as const;\n\nexport const interestConfirmationEmail = ${sourceLiteral(interestConfirmationEmail)} as const;\n`;

  yield* Effect.gen(function* writeOutput() {
    const temporaryDirectory = yield* fileSystem
      .makeTempDirectoryScoped({
        directory: path.dirname(output),
        prefix: ".bundled-content.",
      })
      .pipe(
        Effect.mapError((cause) =>
          buildError("create temporary directory", output, cause)
        )
      );

    const temporaryIcons = path.join(temporaryDirectory, "icons.ts");
    yield* fileSystem
      .writeFileString(
        temporaryIcons,
        `export const ratSvg = ${sourceLiteral(emojiSvg)} as const;\nexport const faviconIcoBase64 = ${sourceLiteral(faviconIcoBase64)} as const;\nexport const appleTouchIconPngBase64 = ${sourceLiteral(appleTouchIconPngBase64)} as const;\n`
      )
      .pipe(
        Effect.mapError((cause) =>
          buildError("write icons", temporaryIcons, cause)
        )
      );
    yield* fileSystem
      .rename(
        temporaryIcons,
        path.join(path.dirname(output), "rat-icons.generated.ts")
      )
      .pipe(
        Effect.mapError((cause) =>
          buildError("rename icons", temporaryIcons, cause)
        )
      );
    const temporaryOutput = path.join(temporaryDirectory, "output.ts");

    yield* fileSystem
      .writeFileString(
        temporaryOutput,
        `${generated}\nexport const errorPageTemplates = ${sourceLiteral({ actionsHtml: errorActions.bodyHtml, actionsMarkdown: errorActionsMarkdown, documentHtml: errorPageDocumentHtml, markdown: errorPageMarkdown, noVerifyDetails: noVerifyErrorDetails, suggestionHtml: errorSuggestion.bodyHtml, suggestionMarkdown: errorSuggestionMarkdown })} as const;\n`
      )
      .pipe(
        Effect.mapError((cause) => buildError("write", temporaryOutput, cause))
      );
    yield* fileSystem
      .rename(temporaryOutput, output)
      .pipe(Effect.mapError((cause) => buildError("rename", output, cause)));
  }).pipe(Effect.scoped);
  yield* snapshot.save;
}).pipe(Effect.provide([shikiLayer(), NodeServices.layer]));

NodeRuntime.runMain(program);
