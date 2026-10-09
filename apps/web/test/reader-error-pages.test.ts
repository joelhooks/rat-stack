import { NodeServices } from "@effect/platform-node";
import { expect, it } from "@effect/vitest";
import { Effect, FileSystem, Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import {
  injectIntoTemplate,
  renderToString,
} from "foldkit/experimental/server";

import { compileReaderBody } from "../../mischief/scripts/reader-body-document.ts";
import { documentMetadata } from "../../mischief/scripts/reader-site-inputs.ts";
import { renderErrorPage } from "../../mischief/src/error-page.ts";
import { ReaderErrorPage } from "../../mischief/src/reader-error-page.ts";
import { init } from "../src/client/reader/init.js";
import { ReaderFlags } from "../src/client/reader/model.js";
import { view } from "../src/features/reader.js";
import { ReaderErrorTemplate } from "../src/server/reader-error-template.js";
import {
  readerErrorFlags,
  readerErrorShell,
} from "../src/server/reader-error.js";
import { normalizedNodes } from "./reader-node-normalize.js";

const origin = "https://ratstack.sh";

const footerLinks = (html: string) =>
  [
    ...(/<footer[\s\S]*?<\/footer>/u.exec(html)?.[0] ?? "").matchAll(
      /href="(?<href>[^"]*)"/gu
    ),
  ].map((match) => match.groups?.href);

const template = Effect.gen(function* builtTemplate() {
  const fs = yield* FileSystem.FileSystem;

  const source = yield* fs.readFileString(
    new URL("../dist/reader-error.json", import.meta.url).pathname
  );

  const shell = yield* fs.readFileString(
    new URL("../dist/reader-error-shell.html", import.meta.url).pathname
  );

  return {
    shell,
    template: yield* Schema.decodeUnknownEffect(
      Schema.fromJsonString(ReaderErrorTemplate)
    )(source),
  };
}).pipe(Effect.provide(NodeServices.layer));

const tokenText = Arbitrary.array(
  Arbitrary.schema(
    Schema.Literals([
      "ERROR_CODE",
      "ERROR_TITLE",
      "ERROR_MESSAGE",
      "ERROR_PATH",
      "ERROR_DETAILS",
      "ERROR_ACTIONS",
      "ERROR_LINK_TITLE",
      "ERROR_LINK_PATH",
      "<b>",
      "&amp;",
      " ",
    ])
  ),
  { maxLength: 4 }
).pipe(Arbitrary.map((parts) => parts.join("")));

it.effect.prop(
  "ReaderErrorParity: a Website error page keeps the Mischief body, heading, metadata and footer",
  { generated: Arbitrary.schema(ReaderErrorPage), tokens: tokenText },
  ({ generated, tokens }) =>
    Effect.gen(function* errorPageParity() {
      const page = {
        ...generated,
        matches: generated.matches?.map((match) => ({
          ...match,
          description: `${tokens}${match.description}`,
          title: `${match.title}${tokens}`,
        })),
        message: `${generated.message}${tokens}`,
        path: `${tokens}${generated.path}`,
        title: `${tokens}${generated.title}`,
      };

      const built = yield* template;
      const flags = readerErrorFlags(built.template, page);
      const mischief = renderErrorPage(page, origin, true);

      const rendered = yield* renderToString(
        { Flags: ReaderFlags, init, view },
        { flags, isHydratable: false }
      );

      const before = yield* compileReaderBody(mischief, "error-page.md");
      const after = yield* compileReaderBody(rendered.html, "error-page.md");
      const metadata = documentMetadata("/", mischief);

      const document = injectIntoTemplate(
        readerErrorShell(built.shell, page),
        rendered
      );

      expect(after.heading).toBe(before.heading);
      expect(normalizedNodes(after.nodes)).toEqual(
        normalizedNodes(before.nodes)
      );
      expect(flags.page.status).toBe(page.code);
      expect({
        ...documentMetadata("/", document),
        jsonLd: metadata.jsonLd,
      }).toEqual(metadata);
      expect(footerLinks(rendered.html)).toEqual(footerLinks(mischief));
    }),
  { arbitrary: { runs: 100 } }
);
