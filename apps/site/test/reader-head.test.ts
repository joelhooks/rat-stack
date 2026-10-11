import { expect, it } from "@effect/vitest";
import { Schema } from "effect";
import * as Arbitrary from "effect/Arbitrary";
import { DomUtils, parseDocument } from "htmlparser2";

import type { ReaderPageMetadata } from "../../web/src/page-descriptor.js";
import { readerMetadataHead } from "../../web/src/reader-metadata.js";
import { renderDocument } from "../../web/src/server/reader-document.js";

const text = Schema.String.check(
  Schema.isPattern(/^[a-zA-Z0-9 <>&"'-]{1,80}$/u)
);

const previewNumber = Schema.Int.check(
  Schema.isGreaterThanOrEqualTo(1),
  Schema.isLessThanOrEqualTo(9999)
);

it.prop(
  "renders preview metadata without losing escaped text or duplicating document metadata",
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

    const application = {
      canonical: `${origin}${metadata.canonicalPath}`,
      html: "<main>reader</main>",
      ogUrl: `${origin}${metadata.canonicalPath}`,
      readerHead: readerMetadataHead(metadata, origin),
      title,
    };

    const html = renderDocument(application, {
      entryScript: "/assets/reader.js",
      modulePreloads: [],
      stylesheets: [],
    });

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
  "preserves document content and escaped payload text while linking the built browser assets",
  { fragment: Arbitrary.schema(Schema.String) },
  ({ fragment }) => {
    const body = `<main><h1>Reader</h1><script type="application/json">${JSON.stringify({ fragment }).replaceAll("<", "\\u003c")}</script></main>`;

    const application = {
      html: body,
      readerHead: '<meta name="description" content="Typed reader">',
      title: "Reader",
    };

    const html = renderDocument(application, {
      entryScript: "/assets/reader.js",
      modulePreloads: ["/assets/shared.js"],
      stylesheets: ["/assets/reader.css"],
    });

    const document = parseDocument(html);
    const scripts = DomUtils.getElementsByTagName("script", document.children);

    const payload = scripts.find(
      (element) => element.attribs.type === "application/json"
    );

    expect(DomUtils.textContent(payload === undefined ? [] : [payload])).toBe(
      JSON.stringify({ fragment }).replaceAll("<", "\\u003c")
    );
    expect(
      DomUtils.textContent(
        DomUtils.getElementsByTagName("h1", document.children)
      )
    ).toBe("Reader");
    expect(
      scripts.find((element) => element.attribs.type === "module")?.attribs.src
    ).toBe("/assets/reader.js");
    const links = DomUtils.getElementsByTagName("link", document.children);
    expect(
      links.find((element) => element.attribs.rel === "stylesheet")?.attribs
        .href
    ).toBe("/assets/reader.css");
    expect(
      links.find((element) => element.attribs.rel === "modulepreload")?.attribs
        .href
    ).toBe("/assets/shared.js");
  }
);
