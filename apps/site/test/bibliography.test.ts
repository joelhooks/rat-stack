import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Path } from "effect";

import {
  ContentBuildError,
  parseLorePage,
  renderBibliography,
} from "../scripts/content-lib.ts";
import { parseContentMarkdown, visitContentNodes } from "../scripts/svx-ast.ts";
import { loreSources } from "./generated-content.js";

it.layer(NodeServices.layer)((test) => {
  test.effect(
    "rejects planted missing titles and notes at the content-build boundary",
    () =>
      Effect.gen(function* rejectIncompleteSources() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const sourcePath = ".brain/areas/analytics.svx";

        const text = yield* fs.readFileString(
          path.resolve(import.meta.dirname, "../../..", sourcePath)
        );

        const { bibliography } = parseLorePage(sourcePath, text);
        expect(bibliography).toContainEqual(
          expect.objectContaining({
            title: "Workers Logs",
            url: "https://developers.cloudflare.com/workers/observability/logs/workers-logs/",
          })
        );

        for (const field of ["title", "note"] as const) {
          const missing = text.replace(
            new RegExp(`^    ${field}:.*\\n`, "mu"),
            ""
          );

          const blank = text.replace(
            new RegExp(`^    ${field}:.*$`, "mu"),
            `    ${field}: " "`
          );

          expect(missing).not.toBe(text);

          for (const violation of [missing, blank]) {
            expect(() => parseLorePage(sourcePath, violation)).toThrow(
              ContentBuildError
            );
            expect(() => parseLorePage(sourcePath, violation)).toThrow(
              sourcePath
            );
          }
        }

        const legacy = text.replace(
          / {2}- url:[\s\S]*?(?= {2}- url:)/u,
          "  - https://example.com/legacy\n"
        );

        expect(() => parseLorePage(sourcePath, legacy)).toThrow(
          /bibliography failed/u
        );
      })
  );

  test.effect(
    "serves the same complete bibliography on every HTML and markdown page",
    () =>
      Effect.gen(function* checkPublishedBibliographies() {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;

        for (const page of loreSources) {
          const raw = yield* fs.readFileString(
            path.resolve(import.meta.dirname, "../../..", page.sourcePath)
          );

          const { bibliography } = parseLorePage(page.sourcePath, raw);
          const rendered = renderBibliography(bibliography);
          expect(page.documentHtml, page.routePath).toContain(rendered.html);
          expect(page.text, page.routePath).toContain(rendered.markdown);
          expect(page.documentHtml).not.toContain(
            '<p>Sources: <a href="https://'
          );

          for (const source of bibliography) {
            if (source.kind === "linked") {
              expect(rendered.html).not.toContain(`>${source.url}</a>`);
              expect(rendered.html).toContain(`Accessed ${source.accessed}.`);
            } else {
              expect(rendered.html).toContain(`Recorded ${source.recordedAt}.`);
            }
          }
        }
      })
  );
});

it.effect(
  "escapes source text without changing link targets or ordered entries",
  () =>
    Effect.sync(() => {
      const source = {
        accessed: "2026-10-01",
        kind: "linked" as const,
        note: "Used for <sink> & its options.",
        publisher: "Docs",
        title: 'The "sink" [options] <guide>',
        url: "https://example.com/?a=1&b=2",
      };

      const rendered = renderBibliography([source, source]);
      expect(rendered.html).toContain(
        'href="https://example.com/?a=1&amp;b=2"'
      );
      expect(rendered.html).toContain("&lt;guide&gt;");
      expect(rendered.html).toContain("&lt;sink&gt; &amp;");
      const references: { title: string; url: string }[] = [];
      visitContentNodes(parseContentMarkdown(rendered.markdown), (node) => {
        if (node.type === "link") {
          references.push({
            title: node.children
              .map((child) => (child.type === "text" ? child.value : ""))
              .join(""),
            url: node.url,
          });
        }
      });
      expect(references).toEqual([
        { title: source.title, url: source.url },
        { title: source.title, url: source.url },
      ]);
      expect(rendered.markdown).toContain("\n2. ");
      expect(renderBibliography([])).toEqual({ html: "", markdown: "" });
    })
);
