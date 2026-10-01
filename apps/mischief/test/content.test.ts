import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import { compile as compileMdsvex } from "mdsvex";
import { compile as compileSvelte } from "svelte/compiler";

import {
  assertDocumentTitle,
  assertLoreTerms,
  assertSkillGroups,
  ContentBuildError,
  debtLedgerMarkdown,
  deriveAgentMarkdown,
  deriveHtmlMarkdown,
  encodeIco,
  escapeSvelteBraces,
  internalRouteForLink,
  isDebtSourcePath,
  linkLoreTerms,
  loreLinkTargets,
  parseDebtLintOutput,
  parseLorePage,
  SYSTEM_SECTIONS,
  SYSTEMS_DIRECTORY,
  validateInternalLinks,
  withMarkdownTitle,
} from "../scripts/content-lib.ts";
import {
  appleTouchIconPngBase64,
  faviconIcoBase64,
  homeDocumentHtml,
  interestConfirmDocumentHtml,
  interestResultDocumentHtml,
  lawSources,
  loreIndexDocumentHtml,
  loreIndexMarkdown,
  loreSources,
  ogImages,
  noVerifyDocumentHtml,
  originToken,
  skillIndexDocumentHtml,
  skillIndexMarkdown,
  skillSources,
  systemsIndexDocumentHtml,
  tokenmaxxDocumentHtml,
} from "../src/bundled-content.generated.js";
import { llmsText, searchContent } from "../src/content.js";

const fakePng = (size: number) => new Uint8Array(size).fill(size);

const root = (path: Path.Path) => path.resolve(import.meta.dirname, "../../..");

it.effect("decodes Oxlint JSON and formats the debt ledger", () =>
  Effect.sync(() => {
    const output = JSON.stringify({
      diagnostics: [
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "root.config.ts",
          labels: [{ span: { column: 0, length: 10, line: 1, offset: 0 } }],
          message: JSON.stringify({
            directive: "@ts-nocheck",
            kind: "typescript",
            reason: "root config directive",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 3, offset: 50 } }],
          message: JSON.stringify({
            directive: [
              "@effect-diagnostics",
              "-next-line asyncFunction:off",
            ].join(""),
            kind: "effect-diagnostics",
            reason: "typed boundary",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 4, offset: 80 } }],
          message: JSON.stringify({
            directive: "@ts-expect-error",
            kind: "typescript",
          }),
          severity: "error",
        },
        {
          code: "rat-stack-debt(debt-ledger)",
          filename: "apps/sample.ts",
          labels: [{ span: { column: 0, length: 10, line: 2, offset: 20 } }],
          message: JSON.stringify({
            directive: "oxlint-disable-next-line no-console",
            kind: "oxlint",
            reason: "fixture reason",
          }),
          severity: "error",
        },
      ],
      number_of_files: 4,
      number_of_rules: 1,
      start_time: 0.08,
      threads_count: 16,
    });

    const result = parseDebtLintOutput(output);
    const markdown = debtLedgerMarkdown(result.entries);

    expect(result).toMatchObject({ fileCount: 4, ruleCount: 1 });
    expect(result.entries).toHaveLength(4);
    expect(result.entries[0]).toMatchObject({
      directive: "oxlint-disable-next-line no-console",
      file: "apps/sample.ts",
      line: 2,
      reason: "fixture reason",
    });
    expect(result.entries[2]?.reason).toBeUndefined();
    expect(markdown).toContain('> "Debt only shrinks."');
    expect(markdown).toContain("Total: **4** directives.");
    expect(markdown).toContain("apps/sample.ts:2");
    expect(markdown).toContain("no reason given");
    expect(markdown).toContain("Dillon Mulroy's code");
    expect(markdown).toBe(debtLedgerMarkdown(result.entries));
    expect(isDebtSourcePath("root.config.ts")).toBe(true);
    expect(isDebtSourcePath("tools/oxlint/anti-slop/vendor.ts")).toBe(false);
    expect(isDebtSourcePath("apps/generated.generated.ts")).toBe(false);
    expect(() => parseDebtLintOutput("not JSON")).toThrow(ContentBuildError);
  })
);

it.effect("requires every discovered skill to have a group", () =>
  Effect.sync(() => {
    expect(() => {
      assertSkillGroups(
        ["learn-rat-stack", "unassigned-skill"],
        [{ names: ["learn-rat-stack"] }]
      );
    }).toThrow(ContentBuildError);
    expect(() => {
      assertSkillGroups(
        ["learn-rat-stack", "unassigned-skill"],
        [{ names: ["learn-rat-stack"] }]
      );
    }).toThrow("skills/unassigned-skill/SKILL.md");
  })
);

it.effect("rejects unserved relative and absolute internal links", () =>
  Effect.sync(() => {
    const knownRoutes = new Set(["/", "/resources/peers.svx"]);

    expect(
      internalRouteForLink("../projects/hidden.svx", "/resources/peers.svx")
    ).toBe("/projects/hidden.svx");
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[broken](/resources/missing.svx)",
      });
    }).toThrow(/internal link \/resources\/missing\.svx failed for/u);
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[relative](./missing.svx)",
      });
    }).toThrow(/\.\/missing\.svx/u);
    expect(() => {
      validateInternalLinks({
        knownRoutes,
        pageRoute: "/resources/peers.svx",
        sourcePath: ".brain/resources/peers.svx",
        text: "[external](https://example.com/page)",
      });
    }).not.toThrow();
  })
);

it.effect("rejects malformed lore frontmatter and filename slugs", () =>
  Effect.sync(() => {
    const invalidFrontmatterPath = ".brain/resources/lore/one-idea.svx";
    const invalidSlugPath = ".brain/resources/lore/Bad_slug.svx";
    const validFields = `---\ntitle: "One idea"\ndescription: "A short sentence."\ngroup: idea\nterms:\n  - "one idea"\nsources: []\n---\n`;

    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        `---\ndescription: "A short sentence."\nsources: []\n---\n`
      )
    ).toThrow(
      new RegExp(`frontmatter failed for ${invalidFrontmatterPath}`, "u")
    );
    expect(() => parseLorePage(invalidSlugPath, validFields)).toThrow(
      new RegExp(`frontmatter failed for ${invalidSlugPath}`, "u")
    );
    expect(() => parseLorePage(invalidSlugPath, validFields)).toThrow(
      ContentBuildError
    );
    expect(parseLorePage(invalidFrontmatterPath, validFields).sources).toEqual(
      []
    );
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace("group: idea\n", "")
      )
    ).toThrow(
      new RegExp(`frontmatter failed for ${invalidFrontmatterPath}`, "u")
    );
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace("group: idea", "group: mystery")
      )
    ).toThrow(ContentBuildError);
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace(
          "sources: []",
          "sources:\n  - http://example.com/source"
        )
      )
    ).toThrow(ContentBuildError);
    expect(() =>
      parseLorePage(
        invalidFrontmatterPath,
        validFields.replace(
          "A short sentence.",
          "First sentence. Second sentence."
        )
      )
    ).toThrow(ContentBuildError);
  })
);

it.effect(
  "serves system pages from the areas folder only when they keep every section",
  () =>
    Effect.sync(() => {
      const systemPath = `${SYSTEMS_DIRECTORY}/one-system.svx`;
      const lorePath = ".brain/resources/lore/one-system.svx";
      const frontmatter = `---\ntitle: "One system"\ndescription: "A short sentence."\ngroup: system\nterms:\n  - "one system"\nsources: []\n---\n`;

      const sections = SYSTEM_SECTIONS.map(
        (section) => `## ${section}\n\nText.\n`
      );

      const page = `${frontmatter}\n${sections.join("\n")}`;

      expect(parseLorePage(systemPath, page).routePath).toBe(
        "/systems/one-system"
      );
      expect(() => parseLorePage(lorePath, page)).toThrow(ContentBuildError);
      expect(() =>
        parseLorePage(systemPath, page.replace("group: system", "group: idea"))
      ).toThrow(ContentBuildError);

      for (const [index] of SYSTEM_SECTIONS.entries()) {
        const withoutOne = `${frontmatter}\n${sections
          .filter((_, other) => other !== index)
          .join("\n")}`;

        expect(() => parseLorePage(systemPath, withoutOne)).toThrow(
          ContentBuildError
        );
      }
    })
);

it.effect("rejects links to missing lore pages with their source path", () =>
  Effect.sync(() => {
    const sourcePath = ".brain/resources/lore/one-idea.svx";

    expect(() =>
      loreLinkTargets(
        sourcePath,
        "See [a missing idea](/lore/not-here).",
        new Set(["/lore/one-idea"])
      )
    ).toThrow(new RegExp(`lore link failed for ${sourcePath}`, "u"));
  })
);

it.effect(
  "weaves the first lore term and skips headings, code, and links",
  () =>
    Effect.sync(() => {
      const tree = {
        children: [
          {
            children: [{ type: "text", value: "Cartridge" }],
            tagName: "h2",
            type: "element",
          },
          {
            children: [
              { type: "text", value: "Cartridge first, cartridge again." },
            ],
            tagName: "p",
            type: "element",
          },
          {
            children: [
              {
                children: [{ type: "text", value: "cartridge" }],
                tagName: "code",
                type: "element",
              },
            ],
            tagName: "pre",
            type: "element",
          },
          {
            children: [
              {
                children: [{ type: "text", value: "cartridge" }],
                properties: { href: "/already-linked" },
                tagName: "a",
                type: "element",
              },
              { type: "text", value: " cartridge at the end." },
            ],
            tagName: "p",
            type: "element",
          },
        ],
        type: "root",
      };

      const linkedRoutes = new Set<string>();
      const wovenTerms = new Map<string, string>();

      linkLoreTerms(
        [{ routePath: "/lore/cartridges", term: "cartridge" }],
        "/another-page",
        linkedRoutes,
        12,
        wovenTerms
      )()(tree);

      const rendered = JSON.stringify(tree);

      expect(rendered.split('"href":"/lore/cartridges"')).toHaveLength(2);
      expect(rendered).toContain('"value":"Cartridge"');
      expect(rendered).toContain('"value":" first, cartridge again."');
      expect(linkedRoutes).toEqual(new Set(["/lore/cartridges"]));
      expect(wovenTerms).toEqual(new Map([["/lore/cartridges", "cartridge"]]));
    })
);

it.effect("caps woven lore terms at twelve links per page", () =>
  Effect.sync(() => {
    const targets = Array.from({ length: 13 }, (_, index) => ({
      routePath: `/lore/signal-${index + 1}`,
      term: `signal ${index + 1}`,
    }));

    const tree = {
      children: targets.map(({ term }) => ({
        children: [{ type: "text", value: term }],
        tagName: "p",
        type: "element",
      })),
      type: "root",
    };

    const linkedRoutes = new Set<string>();

    linkLoreTerms(targets, "/another-page", linkedRoutes)()(tree);

    expect(linkedRoutes.size).toBe(12);
  })
);

it.effect("rejects a lore term claimed by two pages", () =>
  Effect.sync(() => {
    let thrown: ContentBuildError | undefined;

    try {
      assertLoreTerms([
        { sourcePath: ".brain/resources/lore/one.svx", terms: ["shared term"] },
        { sourcePath: ".brain/resources/lore/two.svx", terms: ["Shared term"] },
      ]);
    } catch (error) {
      if (Schema.is(ContentBuildError)(error)) {
        thrown = error;
      }
    }

    expect(thrown).toBeInstanceOf(ContentBuildError);
    expect(thrown?.cause).toMatchObject({
      message: 'term "Shared term" is claimed by multiple pages',
    });
    expect(thrown?.sourcePath).toBe(
      ".brain/resources/lore/two.svx (previous claimant: .brain/resources/lore/one.svx)"
    );
    expect(thrown?.stage).toBe("lore terms");
  })
);

const tagFreeSources = [
  "AGENTS.md",
  "VISION.md",
  "README.md",
  "vendor/README.md",
  "skills/add-a-capability/SKILL.md",
  "skills/add-a-lifecycle-machine/SKILL.md",
  "skills/keep-or-cut/SKILL.md",
  "skills/learn-alchemy/SKILL.md",
  "skills/learn-rat-stack/SKILL.md",
];

it.layer(NodeServices.layer)("generated content", (test) => {
  test.effect("every generated HTML page has exactly one document title", () =>
    Effect.sync(() => {
      const pages = [
        homeDocumentHtml,
        skillIndexDocumentHtml,
        loreIndexDocumentHtml,
        systemsIndexDocumentHtml,
        noVerifyDocumentHtml,
        tokenmaxxDocumentHtml,
        interestResultDocumentHtml,
        interestConfirmDocumentHtml,
        ...lawSources.map((page) => page.documentHtml),
        ...skillSources.map((page) => page.documentHtml),
        ...loreSources.map((page) => page.documentHtml),
      ];

      for (const [index, html] of pages.entries()) {
        expect(() => {
          assertDocumentTitle(html, `page ${index}`);
        }).not.toThrow();
      }

      const page = homeDocumentHtml;
      const missingTitle = page.replace(/<h1\b[^>]*>[\s\S]*?<\/h1>/iu, "");

      const duplicateTitle = page.replace(
        "</main>",
        "<h1>Planted title</h1></main>"
      );

      expect(() => {
        assertDocumentTitle(missingTitle, "planted missing H1");
      }).toThrow("document title failed for planted missing H1");
      expect(() => {
        assertDocumentTitle(duplicateTitle, "planted duplicate H1");
      }).toThrow("document title failed for planted duplicate H1");
    })
  );

  test.effect(
    "front-matter titles reach HTML and agent markdown without duplicating body titles",
    () =>
      Effect.sync(() => {
        for (const slug of [
          "cartridges",
          "analytics",
          "capabilities",
          "fence",
          "database",
          "auth",
        ]) {
          const page = loreSources.find((entry) => entry.slug === slug);

          expect(page).toBeDefined();
          expect(page?.text.startsWith(`# ${page.title}\n`)).toBe(true);
          expect(page?.documentHtml).toContain(`>${page?.title}</h1>`);
        }

        const existing = "# Existing title\n\nBody.";
        const missing = "---\ntitle: Missing title\n---\n\n## First section";

        expect(
          withMarkdownTitle(existing, "Front matter", "<h1>Existing title</h1>")
        ).toBe(existing);
        expect(
          withMarkdownTitle(missing, "Missing title", "<h2>First section</h2>")
        ).toBe("# Missing title\n\n## First section");
      })
  );

  test.effect("the Oxlint ledger rule reads directives from comments", () =>
    Effect.gen(function* readsOnlyCommentDirectives() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
      const repository = root(path);
      const directory = yield* fileSystem.makeTempDirectoryScoped();
      const fixturePath = path.join(directory, "debt-ledger-fixture.ts");
      const effectDiagnostics = ["@effect", "-diagnostics"].join("");

      const fixture = [
        `const mention = "oxlint-disable ${effectDiagnostics} @ts-ignore";`,
        "// oxlint-disable-next-line test/rule -- lint reason",
        "const lintDirective = true;",
        `// ${effectDiagnostics}-next-line testRule:off -- Effect reason`,
        "const effectDirective = true;",
        "// @ts-expect-error -- TypeScript reason",
        "const typed: string = 1;",
        "// oxlint-enable test/rule -- not debt",
      ].join("\n");

      yield* fileSystem.writeFileString(fixturePath, fixture);

      const handle = yield* spawner.spawn(
        ChildProcess.make(
          "pnpm",
          [
            "exec",
            "oxlint",
            "--config",
            path.join(repository, "scripts/oxlint-debt-ledger.config.ts"),
            "-A",
            "all",
            "-D",
            "rat-stack-debt/debt-ledger",
            "--format",
            "json",
            "--no-ignore",
            fixturePath,
          ],
          { cwd: repository }
        )
      );

      const [json, stderr] = yield* Effect.all(
        [
          Stream.mkString(Stream.decodeText(handle.stdout)),
          Stream.mkString(Stream.decodeText(handle.stderr)),
        ],
        { concurrency: "unbounded" }
      );

      const exitCode = yield* handle.exitCode;
      const result = parseDebtLintOutput(json);

      expect(exitCode).toBe(1);
      expect(stderr).toBe("");
      expect(result).toMatchObject({ fileCount: 1, ruleCount: 1 });
      expect(
        result.entries.map(({ directive, kind, line, reason }) => ({
          directive,
          kind,
          line,
          reason,
        }))
      ).toEqual([
        {
          directive: "oxlint-disable-next-line test/rule",
          kind: "oxlint",
          line: 2,
          reason: "lint reason",
        },
        {
          directive: `${effectDiagnostics}-next-line testRule:off`,
          kind: "effect-diagnostics",
          line: 4,
          reason: "Effect reason",
        },
        {
          directive: "@ts-expect-error",
          kind: "typescript",
          line: 6,
          reason: "TypeScript reason",
        },
      ]);
    })
  );

  test.effect("keeps tag-free source documents byte-identical for agents", () =>
    Effect.gen(function* tagFreeSourcesRoundTrip() {
      const fileSystem = yield* FileSystem.FileSystem;
      const path = yield* Path.Path;
      const repository = root(path);

      for (const source of tagFreeSources) {
        const text = yield* fileSystem.readFileString(
          path.join(repository, source)
        );

        expect(deriveAgentMarkdown(text), source).toBe(text);
      }
    })
  );

  test.effect("derives the agent and HTML audience representations", () =>
    Effect.sync(() => {
      const fixture = `# Audience\n\n<AgentOnly>\nAgent instruction.\n</AgentOnly>\n\n<HumanOnly>\nHuman caption.\n</HumanOnly>\n\n<Diagram alt="A small map">\n\n\`\`\`text\n┌─┐\n└─┘\n\`\`\`\n</Diagram>\n`;
      const agent = deriveAgentMarkdown(fixture);
      const html = deriveHtmlMarkdown(fixture);

      expect(agent).toContain("Agent instruction.");
      expect(agent).not.toContain("Human caption.");
      expect(agent).toContain("```text\n┌─┐\n└─┘\n```");
      expect(agent).toContain("Diagram: A small map");
      expect(agent).not.toContain("<AgentOnly>");
      expect(agent).not.toContain("<Diagram");

      expect(html).not.toContain("<AgentOnly>");
      expect(html).toContain("Human caption.");
      expect(html).toContain('<figure role="img" aria-label="A small map">');
      expect(html).toContain("<figcaption>A small map</figcaption>");
    })
  );

  test.effect("groups lore in agent output and searches declared terms", () =>
    Effect.sync(() => {
      const cartridge = loreSources.find((lore) => lore.slug === "cartridges");
      const [match] = searchContent("cartridge test");
      const llms = llmsText("https://ratstack.sh");

      expect(cartridge?.group).toBe("idea");
      expect(cartridge?.terms).toContain("cartridge test");
      expect(match?.routePath).toBe("/lore/cartridges");
      expect(llms).toContain("### Idea");
      expect(llms).toContain("### Concept");
      expect(llms).toContain("### Source");
      expect(llms).toContain("### Person");
      expect(llms).toContain("## Lore on this page");
    })
  );

  test.effect("serves markdown without the origin placeholder", () =>
    Effect.sync(() => {
      const servedVerbatim = [
        ...lawSources.map(({ routePath, text }) => ({ routePath, text })),
        ...skillSources.map(({ routePath, text }) => ({ routePath, text })),
        ...loreSources.map(({ routePath, text }) => ({ routePath, text })),
        { routePath: "/skills", text: skillIndexMarkdown },
        { routePath: "/lore", text: loreIndexMarkdown },
      ];

      expect(
        servedVerbatim.flatMap(({ routePath, text }) =>
          text.includes(originToken) ? [routePath] : []
        )
      ).toEqual([]);
    })
  );

  test.effect("shows non-lore sources in lore backlinks", () =>
    Effect.sync(() => {
      const fence = loreSources.find((lore) => lore.slug === "the-fence");

      expect(fence?.documentHtml).toContain("<strong>Source file</strong>");
      expect(fence?.documentHtml).toContain(
        '<a href="/VISION.md">VISION.md</a>'
      );
      expect(homeDocumentHtml).toContain('href="/lore/');
    })
  );

  test.effect("uses Shiki for code and leaves text diagrams uncoloured", () =>
    Effect.sync(() => {
      expect(homeDocumentHtml).toContain('class="shiki catppuccin-latte"');
      expect(homeDocumentHtml).toMatch(
        /<figure role="img"[^>]*>\s*<pre><code>/u
      );
      expect(homeDocumentHtml).not.toMatch(
        /<figure role="img"[^>]*>\s*<pre[^>]*style=/u
      );
    })
  );

  test.effect("packs PNG images into an ICO directory", () =>
    Effect.sync(() => {
      const ico = encodeIco([
        { bytes: fakePng(3), size: 16 },
        { bytes: fakePng(5), size: 256 },
      ]);

      const view = new DataView(ico.buffer);

      expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 2, 0]);
      expect(ico[6]).toBe(16);
      expect(view.getUint16(6 + 6, true)).toBe(32);
      expect(view.getUint32(6 + 8, true)).toBe(3);
      expect(view.getUint32(6 + 12, true)).toBe(38);
      expect(ico[22]).toBe(0);
      expect(view.getUint32(22 + 12, true)).toBe(41);
      expect(ico.length).toBe(38 + 3 + 5);
    })
  );

  test.effect("renders the rat as a favicon and a touch icon", () =>
    Effect.sync(() => {
      const ico = Buffer.from(faviconIcoBase64, "base64");
      expect([...ico.subarray(0, 6)]).toEqual([0, 0, 1, 0, 3, 0]);
      expect([ico[6], ico[22], ico[38]]).toEqual([16, 32, 48]);

      const touch = Buffer.from(appleTouchIconPngBase64, "base64");
      expect([...touch.subarray(1, 4)]).toEqual([0x50, 0x4e, 0x47]);
      expect(touch.readUInt32BE(16)).toBe(180);
      expect(touch.readUInt32BE(20)).toBe(180);
    })
  );

  test.effect("embeds the shared stylesheet in static documents", () =>
    Effect.sync(() => {
      const stylesheet =
        /<style>(?<css>[\s\S]*?)<\/style>/u.exec(homeDocumentHtml)?.groups
          ?.css ?? "";

      expect(stylesheet).toContain("ui-monospace");
      expect(stylesheet).toContain("max-width: 80ch");
      expect(homeDocumentHtml).not.toContain('rel="stylesheet"');
    })
  );

  test.effect("keeps the line breaks in a text diagram", () =>
    Effect.sync(() => {
      const figures = homeDocumentHtml.match(
        /<figure role="img"[\s\S]*?<\/figure>/gu
      );

      expect(figures?.length).toBeGreaterThan(0);

      for (const figure of figures ?? []) {
        expect(figure).toMatch(/┐\n/u);
      }
    })
  );

  test.effect("generates a 1200x630 PNG for every public page", () =>
    Effect.sync(() => {
      const expected = new Set([
        "/",
        "/skills",
        "/lore",
        "/systems",
        "/--no-verify",
        "/tokenmaxx",
        ...lawSources.map((source) => source.routePath),
        ...loreSources.map((lore) => lore.routePath),
        ...skillSources.map((skill) => skill.routePath),
      ]);

      expect(new Set(ogImages.map((image) => image.routePath))).toEqual(
        expected
      );

      for (const image of ogImages) {
        const png = Buffer.from(image.pngBase64, "base64");
        expect(png.subarray(0, 8)).toEqual(
          Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
        );
        expect(png.readUInt32BE(16)).toBe(1200);
        expect(png.readUInt32BE(20)).toBe(630);
      }
    })
  );
});

const decodeCompiledMarkdown = Schema.decodeUnknownSync(
  Schema.Struct({ code: Schema.String })
);

it.effect("compiles braces in headings and prose for Svelte", () =>
  Effect.gen(function* compilesBraces() {
    const { code } = yield* Effect.promise(
      // oxlint-disable-next-line typescript/promise-function-async -- mdsvex owns this Promise boundary.
      () =>
        compileMdsvex(
          "## Advertise properties: {} again\n\nProse with {braces}.\n",
          { extensions: [".md"], rehypePlugins: [escapeSvelteBraces] }
        ).then(decodeCompiledMarkdown)
    );

    expect(() => compileSvelte(code, { generate: "server" })).not.toThrow();
    expect(code).toContain("properties: &#123;&#125; again");
  })
);
