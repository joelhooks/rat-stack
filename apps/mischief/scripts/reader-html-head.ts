import { DomUtils, ElementType, parseDocument } from "htmlparser2";

import { ReaderInputError } from "./reader-input-error.ts";

export const finalizeReaderHtml = (
  html: string,
  metadataHead: string,
  sourcePath: string
): string => {
  const document = parseDocument(html, {
    withEndIndices: true,
    withStartIndices: true,
  });

  const heads = DomUtils.getElementsByTagName("head", document.children);
  const head = heads.at(0);

  if (
    heads.length !== 1 ||
    head === undefined ||
    head.startIndex === null ||
    head.endIndex === null
  ) {
    throw new ReaderInputError({
      message:
        "Prerender output must contain one bounded head; rebuild the Foldkit application",
      sourcePath,
    });
  }

  const retained = head.children
    .filter((child) => {
      if (
        child.type !== ElementType.ElementType.Tag &&
        child.type !== ElementType.ElementType.Script &&
        child.type !== ElementType.ElementType.Style
      ) {
        return false;
      }

      return (
        (child.name === "meta" &&
          (child.attribs.charset !== undefined ||
            child.attribs.name === "viewport")) ||
        (child.name === "link" &&
          (child.attribs.rel === "stylesheet" ||
            child.attribs.rel === "icon" ||
            child.attribs.rel === "apple-touch-icon")) ||
        (child.name === "script" && child.attribs.src !== undefined) ||
        child.name === "style"
      );
    })
    .map((child) => {
      if (child.startIndex === null || child.endIndex === null) {
        throw new ReaderInputError({
          message:
            "Prerender head asset lacks a bounded range; rebuild the Foldkit application",
          sourcePath,
        });
      }

      return html.slice(child.startIndex, child.endIndex + 1);
    });

  return `${html.slice(0, head.startIndex)}<head>\n${retained.join("\n")}\n${metadataHead}\n</head>${html.slice(head.endIndex + 1)}`;
};
