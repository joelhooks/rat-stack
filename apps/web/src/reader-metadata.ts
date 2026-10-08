import type { ReaderPageMetadata } from "./page-descriptor.js";

export const escapeAttribute = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export const readerMetadataHead = (
  metadata: ReaderPageMetadata,
  origin: string
): string => {
  const canonical = `${origin}${metadata.canonicalPath}`;
  const image = `${origin}${metadata.ogImagePath}`;
  const publisher = { "@type": "Organization", name: "rat-stack", url: origin };

  const data =
    metadata.jsonLd === "WebSite"
      ? {
          "@context": "https://schema.org",
          "@type": "WebSite",
          description: metadata.description,
          name: "rat-stack",
          publisher,
          url: origin,
        }
      : {
          "@context": "https://schema.org",
          "@type": "TechArticle",
          author: publisher,
          dateModified: metadata.dateModified,
          datePublished: metadata.datePublished,
          description: metadata.description,
          headline: metadata.title,
          mainEntityOfPage: canonical,
          publisher,
          url: canonical,
        };

  const nameMeta = (name: string, content: string) =>
    `<meta name="${escapeAttribute(name)}" content="${escapeAttribute(content)}">`;

  const propertyMeta = (name: string, content: string) =>
    `<meta property="${escapeAttribute(name)}" content="${escapeAttribute(content)}">`;

  return [
    `<title>${escapeAttribute(metadata.title)}</title>`,
    nameMeta("description", metadata.description),
    ...(metadata.robots === "noindex" ? [nameMeta("robots", "noindex")] : []),
    propertyMeta("og:type", "website"),
    propertyMeta("og:title", metadata.title),
    propertyMeta("og:description", metadata.description),
    propertyMeta("og:url", canonical),
    propertyMeta("og:site_name", "ratstack.sh"),
    propertyMeta("og:image", image),
    propertyMeta("og:image:width", "1200"),
    propertyMeta("og:image:height", "630"),
    propertyMeta("og:image:type", "image/png"),
    propertyMeta("og:image:alt", metadata.description),
    nameMeta("twitter:card", "summary_large_image"),
    nameMeta("twitter:title", metadata.title),
    nameMeta("twitter:description", metadata.description),
    nameMeta("twitter:image", image),
    `<link rel="canonical" href="${escapeAttribute(canonical)}">`,
    ...metadata.discoveryLinks.map(
      (link) =>
        `<link rel="${escapeAttribute(link.rel)}" type="${escapeAttribute(link.type)}" href="${escapeAttribute(link.href)}">`
    ),
    ...(metadata.jsonLd === "none"
      ? []
      : [
          `<script type="application/ld+json">${JSON.stringify(data).replaceAll("<", "\\u003c")}</script>`,
        ]),
  ].join("\n");
};
