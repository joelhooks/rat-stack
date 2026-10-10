import { DomUtils, parseDocument } from "htmlparser2";

export const readerHtmlProof = (html: string) => {
  const document = parseDocument(html);
  const headings = DomUtils.getElementsByTagName("h1", document.children);
  const titles = DomUtils.getElementsByTagName("title", document.children);
  const metas = DomUtils.getElementsByTagName("meta", document.children);

  const canonicals = DomUtils.getElementsByTagName(
    "link",
    document.children
  ).filter((element) => element.attribs.rel === "canonical");

  return {
    canonical: canonicals.at(0)?.attribs.href,
    canonicalCount: canonicals.length,
    heading: DomUtils.textContent(headings),
    headingCount: headings.length,
    robots: metas.find((element) => element.attribs.name === "robots")?.attribs
      .content,
    title: DomUtils.textContent(titles),
    titleCount: titles.length,
  };
};
