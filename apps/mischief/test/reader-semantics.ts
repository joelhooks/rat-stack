import { DomUtils, parseDocument } from "htmlparser2";

export const mainSemantics = (html: string) => {
  const document = parseDocument(html);
  const main = DomUtils.getElementsByTagName("main", document.children).at(0);

  if (main === undefined) {
    throw new Error("Reader page has no main element");
  }

  const elements = DomUtils.getElementsByTagName("*", main.children);

  return {
    anchors: elements
      .filter((element) => element.name === "a")
      .map((element) => ({
        href: element.attribs.href,
        text: DomUtils.textContent(element).trim(),
      })),
    headings: elements
      .filter((element) => /^h[1-6]$/u.test(element.name))
      .map((element) => ({
        id: element.attribs.id,
        level: element.name,
        text: DomUtils.textContent(element).trim(),
      })),
    ids: elements.flatMap((element) =>
      element.attribs.id === undefined ? [] : [element.attribs.id]
    ),
    prose: elements
      .filter((element) =>
        /^(?:p|li|pre|summary|figcaption)$/u.test(element.name)
      )
      .map((element) =>
        DomUtils.textContent(element).replaceAll(/\s+/gu, " ").trim()
      ),
    tables: elements
      .filter((element) => ["table", "th", "td"].includes(element.name))
      .map((element) => ({
        label: element.attribs["data-label"],
        name: element.name,
        text: DomUtils.textContent(element).replaceAll(/\s+/gu, " ").trim(),
      })),
    workshopCount: elements.filter((element) =>
      (element.attribs.class ?? "").split(/\s+/u).includes("workshop-callout")
    ).length,
  };
};
