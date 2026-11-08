import { expect, it } from "@effect/vitest";
import { Schema } from "effect";

import { readerMetadataHead } from "../src/reader-metadata.js";

const JsonLd = Schema.Struct({
  "@type": Schema.String,
  about: Schema.optional(Schema.Struct({ codeRepository: Schema.String })),
  itemListElement: Schema.optional(
    Schema.Array(
      Schema.Struct({
        item: Schema.String,
        name: Schema.String,
        position: Schema.Int,
      })
    )
  ),
  publisher: Schema.optional(
    Schema.Struct({ sameAs: Schema.Array(Schema.String) })
  ),
});

it.prop(
  "reader schema keeps repository identity and breadcrumb text without executable markup",
  {
    group: Schema.Literals(["lore", "systems"]),
    title: Schema.String,
  },
  ({ title, group }) => {
    const heading = `${title}</script><script>alert(1)</script>`;

    const metadata = {
      canonicalPath: `/${group}/example`,
      description: title,
      discoveryLinks: [],
      jsonLd: "TechArticle" as const,
      ogImagePath: "/og.png",
      robots: "index" as const,
      title: `${heading} | rat-stack`,
    };

    const head = readerMetadataHead(metadata, "https://ratstack.sh");

    const blocks = [
      ...head.matchAll(
        /<script type="application\/ld\+json">(?<json>[^]*?)<\/script>/gu
      ),
    ].map((match) =>
      Schema.decodeSync(Schema.fromJsonString(JsonLd))(match.groups?.json ?? "")
    );

    expect(head.match(/<script/gu)).toHaveLength(2);
    expect(
      blocks.find((block) => block["@type"] === "TechArticle")?.publisher
        ?.sameAs
    ).toContain("https://github.com/joelhooks/rat-stack");
    expect(
      blocks.find((block) => block["@type"] === "BreadcrumbList")
        ?.itemListElement
    ).toStrictEqual([
      { item: `https://ratstack.sh/${group}`, name: group, position: 1 },
      {
        item: `https://ratstack.sh/${group}/example`,
        name: heading,
        position: 2,
      },
    ]);

    const homepage = readerMetadataHead(
      { ...metadata, canonicalPath: "/", jsonLd: "WebSite" },
      "https://ratstack.sh"
    );

    const website = [
      ...homepage.matchAll(
        /<script type="application\/ld\+json">(?<json>[^]*?)<\/script>/gu
      ),
    ].map((match) =>
      Schema.decodeSync(Schema.fromJsonString(JsonLd))(match.groups?.json ?? "")
    );

    expect(website).toHaveLength(1);
    expect(website[0]?.about?.codeRepository).toBe(
      "https://github.com/joelhooks/rat-stack"
    );
    expect(
      readerMetadataHead({ ...metadata, jsonLd: "none" }, "https://ratstack.sh")
    ).not.toContain("application/ld+json");
  }
);
