import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { DomUtils, parseDocument } from "htmlparser2";

import type { ReaderPageMetadata } from "../../web/src/page-descriptor.js";
import { readerMetadataHead } from "../../web/src/reader-metadata.js";
import { finalizeReaderHtml } from "../scripts/reader-html-head.ts";

const text = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9 <>&"'-]{1,80}$/u)
);

const previewNumber = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(9999)
);

it.prop(
  "projects preview metadata without losing escaped text or duplicating template metadata",
  {
    description: Arbitrary.schema(text),
    number: Arbitrary.schema(previewNumber),
    title: Arbitrary.schema(text),
  },
  ({ description, number, title }) => {
    const origin = `https://pr-${number}.ratstack.sh`;

    const metadata = {
      canonicalPath: "/lore/services-capture-dependencies",
      description,
      discoveryLinks: [],
      jsonLd: "TechArticle",
      ogImagePath: "/og/lore.png",
      robots: "noindex",
      title,
    } satisfies ReaderPageMetadata;

    const html = finalizeReaderHtml(
      '<html><head><title>obsolete</title><meta name="description" content="obsolete"><link rel="canonical" href="https://ratstack.sh/"></head><body>reader</body></html>',
      readerMetadataHead(metadata, origin),
      "/fixture"
    );

    const document = parseDocument(html);
    const titles = DomUtils.getElementsByTagName("title", document.children);
    const metas = DomUtils.getElementsByTagName("meta", document.children);

    const canonicals = DomUtils.getElementsByTagName(
      "link",
      document.children
    ).filter((element) => element.attribs.rel === "canonical");

    expect(titles).toHaveLength(1);
    expect(DomUtils.textContent(titles)).toBe(title);
    expect(
      metas.filter((element) => element.attribs.name === "description")
    ).toHaveLength(1);
    expect(
      metas.find((element) => element.attribs.name === "description")?.attribs
        .content
    ).toBe(description);
    expect(
      metas.find((element) => element.attribs.name === "robots")?.attribs
        .content
    ).toBe("noindex");
    expect(canonicals).toHaveLength(1);
    expect(canonicals.at(0)?.attribs.href).toBe(
      `${origin}${metadata.canonicalPath}`
    );
    expect(
      metas.find((element) => element.attribs.property === "og:url")?.attribs
        .content
    ).toBe(`${origin}${metadata.canonicalPath}`);

    const script = DomUtils.getElementsByTagName(
      "script",
      document.children
    ).find((element) => element.attribs.type === "application/ld+json");

    expect(script).toBeDefined();

    const data = Schema.decodeUnknownSync(
      Schema.fromJsonString(
        Schema.Struct({ headline: Schema.String, url: Schema.String })
      )
    )(DomUtils.textContent(script === undefined ? [] : [script]));

    expect(data.headline).toBe(title);
    expect(data.url).toBe(`${origin}${metadata.canonicalPath}`);
  }
);

it.prop(
  "preserves the full prerender body, hydration payload and built assets while finalizing idempotently",
  { fragment: Arbitrary.schema(Schema.String) },
  ({ fragment }) => {
    const body = `<body><div id="root"><h1>Reader</h1></div><script type="application/json">${JSON.stringify({ fragment }).replaceAll("<", "\\u003c")}</script></body></html>`;
    const source = `<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css"><title>old</title></head>${body}`;

    const metadata =
      '<title>Reader</title><meta name="description" content="Typed reader">';

    const finalized = finalizeReaderHtml(source, metadata, "/fixture");

    expect(finalized.slice(finalized.indexOf("<body>"))).toBe(body);
    expect(finalized).toContain(
      '<script type="module" src="/assets/index.js"></script>'
    );
    expect(finalized).toContain(
      '<link rel="stylesheet" href="/assets/index.css">'
    );
    expect(finalizeReaderHtml(finalized, metadata, "/fixture")).toBe(finalized);
  }
);
