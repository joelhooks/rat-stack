export const normalizeLiveHtml = (
  original: string,
  contentType: string | null,
  enabled = false
) => {
  if (!enabled || contentType?.toLowerCase().startsWith("text/html") !== true) {
    return original;
  }

  const normalized = original.replaceAll(
    /<script\b(?:"[^"]*"|'[^']*'|[^"'<>])*>\s*<\/script>(?:\r?\n)?/giu,
    (tag) => {
      const attributes =
        /^<script\b(?<attributes>(?:"[^"]*"|'[^']*'|[^"'<>])*)>/iu.exec(tag)
          ?.groups?.attributes;

      if (attributes === undefined) {
        return tag;
      }

      let cursor = 0;
      let source: string | undefined;

      for (const token of attributes.matchAll(
        /\s+(?<key>[^\s"'<>/=]+)(?:\s*=\s*(?:"(?<double>[^"]*)"|'(?<single>[^']*)'|(?<bare>[^\s"'<>\u0060=]+)))?/gu
      )) {
        if (attributes.slice(cursor, token.index).trim().length > 0) {
          return tag;
        }

        cursor = token.index + token[0].length;

        if (token.groups?.key?.toLowerCase() !== "src") {
          continue;
        }

        if (source !== undefined) {
          return tag;
        }

        source =
          token.groups.double ?? token.groups.single ?? token.groups.bare;
      }

      if (attributes.slice(cursor).trim().length > 0 || source === undefined) {
        return tag;
      }

      let url: URL;

      try {
        url = new URL(source);
      } catch {
        return tag;
      }

      return url.protocol === "https:" &&
        url.host === "static.cloudflareinsights.com" &&
        (url.pathname === "/beacon.min.js" ||
          url.pathname.startsWith("/beacon.min.js/"))
        ? ""
        : tag;
    }
  );

  return normalized;
};
