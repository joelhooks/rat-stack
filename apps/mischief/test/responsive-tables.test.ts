import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { compile } from "mdsvex";
import remarkGfm from "remark-gfm";
import type { Plugin } from "unified";

import { responsiveTables } from "../scripts/content-lib.ts";
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
          ...html.matchAll(/<div\b[^>]*class="table-wrapper"[^>]*>/gu),
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

const decodeCompiledTable = Schema.decodeUnknownSync(
  Schema.Struct({ code: Schema.String })
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
    })
);
