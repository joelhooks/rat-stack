import { expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { renderToString } from "foldkit/experimental/server";

import { compileReaderDocument } from "../../site/scripts/reader-home-document.ts";
import { ReaderBlock } from "../src/client/reader-document.js";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import { readerFlagsFixture } from "./reader-fixture.js";

it.effect(
  "renders home Markdown tables with headers, cell links and mobile labels",
  () =>
    Effect.gen(function* homeTable() {
      const document = compileReaderDocument(
        "# Rat Stack\n\n## Packages and their jobs\n\n| **Package** | Job | Removal |\n| :--- | ---: | :---: |\n| `auth` | Better Auth | [Checklist](/README.md#keep-or-cut) |\n| core | Shared \\| operations |\n",
        [
          { routePath: "/systems/auth", term: "Better Auth" },
          { routePath: "/lore/jobs", term: "Job" },
        ],
        { heading: "Rat Stack", route: "/" }
      );

      const blocks = yield* Schema.decodeUnknownEffect(
        Schema.Array(ReaderBlock)
      )(document.blocks);

      const rendered = yield* renderToString(
        { Flags: ReaderFlags, init, view },
        { flags: { ...readerFlagsFixture, blocks }, isHydratable: false }
      );

      expect(rendered.html).toContain('role="table"');
      expect(rendered.html).toContain(
        'aria-label="Packages and their jobs table"'
      );
      expect(rendered.html).toContain('tabindex="0"');
      expect(rendered.html).toMatch(
        /<th\b[^>]*scope="col"[^>]*><strong>Package<\/strong><\/th>/u
      );
      expect(rendered.html).toMatch(
        /<td\b[^>]*data-label="Package"[^>]*><code>auth<\/code><\/td>/u
      );
      expect(rendered.html).toContain('href="/systems/auth">Better Auth</a>');
      expect(rendered.html).toContain(
        'href="/README.md#keep-or-cut">Checklist</a>'
      );
      expect(rendered.html).toContain("Shared | operations");
      expect(rendered.html).toMatch(/<th\b[^>]*align="right"[^>]*>Job<\/th>/u);
      expect(rendered.html).toMatch(
        /<td\b[^>]*align="right"[^>]*>Shared \| operations<\/td>/u
      );
      expect(rendered.html).toMatch(
        /<td\b[^>]*data-label="Removal"[^>]*><\/td>/u
      );
    })
);
