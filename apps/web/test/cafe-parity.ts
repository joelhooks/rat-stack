export const parseCafeHtml = (html: string) =>
  new DOMParser().parseFromString(html, "text/html");

export const cafeText = (element: Element) =>
  (element.textContent ?? "").replaceAll(/\s+/gu, " ").trim();

export const cafeAttributes = (
  root: ParentNode,
  selector: string,
  attributes: readonly string[]
) =>
  [...root.querySelectorAll(selector)].map((element) => [
    element.localName,
    ...attributes.flatMap((name) => {
      const value = element.getAttribute(name);

      return value === null ? [] : [`${name}=${value}`];
    }),
  ]);

export const cafeParity = (document: Document, listSelector: string) => ({
  text: [...document.querySelectorAll("header, main, footer")].map(cafeText),
  rows: [...document.querySelectorAll(listSelector)].map(cafeText),
  attributes: cafeAttributes(
    document,
    "main :is([class], a, abbr, button, img, time, details, [role=status])",
    [
      "class",
      "href",
      "rel",
      "title",
      "type",
      "aria-label",
      "aria-pressed",
      "aria-live",
      "src",
      "alt",
      "width",
      "height",
      "loading",
      "datetime",
      "open",
    ]
  ),
});
