import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { compile } from "mdsvex";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";

import { linkLoreTerms, responsiveTables } from "../scripts/content-lib.ts";
import { linkStackEntities } from "../scripts/content-links.ts";
import {
  homeDocumentHtml,
  lawSources,
  loreSources,
  skillSources,
} from "../src/bundled-content.generated.js";

it.effect(
  "labels every published table cell and gives each table a focusable region",
  () =>
    Effect.sync(() => {
      const documents = [
        homeDocumentHtml,
        ...[...lawSources, ...loreSources, ...skillSources].map(
          (source) => source.documentHtml
        ),
      ];

      let cellCount = 0;

      for (const html of documents) {
        const tables = [...html.matchAll(/<table\b[^>]*>/gu)];

        const regions = [
          ...html.matchAll(
            /<div\b[^>]*class="table-wrapper(?: table-wide)?"[^>]*>/gu
          ),
        ];

        expect(regions).toHaveLength(tables.length);

        for (const [tag] of regions) {
          expect(tag).toContain('role="region"');
          expect(tag).toMatch(/aria-label="[^"]+"/u);
          expect(tag).toContain('tabindex="0"');
        }

        for (const [tag] of tables) {
          expect(tag).toContain('role="table"');
        }

        for (const [tag] of html.matchAll(/<td\b[^>]*>/gu)) {
          expect(tag).toMatch(/data-label="[^"]+"/u);
          expect(tag).toContain('role="cell"');
          cellCount += 1;
        }
      }

      expect(cellCount).toBeGreaterThan(0);
    })
);

it.effect("published table headers never acquire automatic term links", () =>
  Effect.sync(() => {
    for (const source of [...lawSources, ...loreSources, ...skillSources]) {
      for (const [header] of source.documentHtml.matchAll(
        /<th\b[^>]*>[\s\S]*?<\/th>/gu
      )) {
        expect(header).not.toContain("<a ");
      }
    }
  })
);

it.effect(
  "short tables use the prose minimum rather than fill the popout",
  () =>
    Effect.sync(() => {
      const css = /<style>(?<css>[\s\S]*?)<\/style>/u.exec(homeDocumentHtml)
        ?.groups?.css;

      expect(css).toBeDefined();
      expect(css).toMatch(
        /main > \.table-wrapper\s*\{[^}]*justify-self: center;/u
      );
      expect(css).toMatch(
        /main > \.table-wrapper\s*\{[^}]*width: min-content;/u
      );
      expect(css).toMatch(
        /main > \.table-wrapper\s*\{[^}]*min-width: min\(80ch, 100%\);/u
      );
      expect(css).toMatch(/\btable\s*\{[^}]*width: auto;/u);
      expect(css).not.toContain("container-type: inline-size");
    })
);

const decodeCompiledTable = Schema.decodeUnknownSync(
  Schema.Struct({ code: Schema.String })
);

it.effect(
  "links library names but not headers or the ordinary word effect",
  () =>
    Effect.gen(function* compilesTermLinks() {
      const result = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- mdsvex owns this Promise boundary.
        () =>
          compile(
            "| Effect | Alchemy | cartridge |\n| --- | --- | --- |\n| effect | Effect on requests | Effect follows a stop. Effect changes nothing. |\n\nAn ordinary effect.\n\nWe use Effect Schema and a cartridge.\n",
            {
              rehypePlugins: [
                linkStackEntities,
                linkLoreTerms(
                  [
                    { routePath: "/lore/effect", term: "Effect" },
                    { routePath: "/lore/cartridges", term: "cartridge" },
                  ],
                  "/fixture",
                  new Set<string>()
                ),
              ],
              // SAFETY: remark-gfm implements the unified remark plugin interface used by mdsvex.
              remarkPlugins: [remarkGfm as Plugin],
            }
          ).then(decodeCompiledTable)
      );

      expect(result.code).toContain("<th>Effect</th>");
      expect(result.code).toContain("<th>Alchemy</th>");
      expect(result.code).toContain("<th>cartridge</th>");
      expect(result.code).toContain("<td>effect</td>");
      expect(result.code).toContain("<td>Effect on requests</td>");
      expect(result.code).toContain(
        "<td>Effect follows a stop. Effect changes nothing.</td>"
      );
      expect(result.code).toContain("An ordinary effect.");
      expect(result.code).toContain('href="https://effect.website"');
      expect(result.code).toContain('href="/lore/cartridges"');
      expect(result.code).not.toContain('href="/lore/effect"');
    })
);

it.effect(
  "derives card labels from formatted GFM headers without dropping empty cells",
  () =>
    Effect.gen(function* compilesResponsiveTable() {
      const result = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- mdsvex owns this Promise boundary.
        () =>
          compile(
            "## Packages\n\n| **Package** | `Path` | Role |\n| --- | --- | --- |\n| `@rat-stack/capability` | packages/capability | |\n",
            {
              rehypePlugins: [responsiveTables],
              // SAFETY: remark-gfm implements the unified remark plugin interface used by mdsvex.
              remarkPlugins: [remarkGfm as Plugin],
            }
          ).then(decodeCompiledTable)
      );

      expect(result?.code).toContain('aria-label="Packages table"');
      expect(result?.code).toContain('data-label="Package"');
      expect(result?.code).toContain('data-label="Path"');
      expect(result?.code).toContain('data-label="Role"');
      expect(result?.code).toContain('role="rowgroup"');
      expect(result?.code).toContain('role="row"');
      expect(result?.code).toContain('role="columnheader"');
      expect(result?.code).toContain('scope="col"');
      expect(result.code).not.toContain("table-wide");
      expect(result.code).toContain('class="table-token"');
    })
);

it.effect(
  "marks only single-letter cells under a Tier header with their tier",
  () =>
    Effect.gen(function* compilesTierTable() {
      const result = yield* Effect.promise(
        // oxlint-disable-next-line typescript/promise-function-async -- mdsvex owns this Promise boundary.
        () =>
          compile(
            "| Tier | Repo | Effect | Alchemy | Checked | First seen |\n| --- | --- | --- | --- | --- | --- |\n| S | upstream | 4.0.0-rc.118 ≠¹ | 2.0.0-beta.79 | 2026-10-01 | 2026-09-23 |\n| C | screened | — | — | — | — |\n| SS | not a tier | — | — | — | — |\n\n| Grade | Repo |\n| --- | --- |\n| A | other table |\n",
            {
              rehypePlugins: [responsiveTables],
              // SAFETY: remark-gfm implements the unified remark plugin interface used by mdsvex.
              remarkPlugins: [remarkGfm as Plugin],
            }
          ).then(decodeCompiledTable)
      );

      expect(result.code).toContain('class="table-wrapper table-wide"');
      expect(result.code).toContain(
        'data-label="Effect" role="cell" class="table-token"'
      );
      expect(result.code).toContain(
        'data-label="Checked" role="cell" class="table-token"'
      );
      expect(result?.code).toContain('data-tier="S"');
      expect(result?.code).toContain('data-tier="C"');
      expect(result?.code).not.toContain('data-tier="SS"');
      expect(result?.code).not.toContain('data-tier="A"');
    })
);
