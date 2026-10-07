import { Data, Schema } from "effect";

export const ReaderTag = Schema.Literals([
  "a",
  "abbr",
  "blockquote",
  "br",
  "caption",
  "cite",
  "code",
  "dd",
  "del",
  "details",
  "div",
  "dl",
  "dt",
  "em",
  "figcaption",
  "figure",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "input",
  "kbd",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "section",
  "small",
  "span",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "th",
  "thead",
  "time",
  "tr",
  "ul",
]);

export const ReaderAttributeName = Schema.Literals([
  "alt",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-hidden",
  "class",
  "colspan",
  "data-label",
  "data-line",
  "datetime",
  "disabled",
  "height",
  "href",
  "id",
  "loading",
  "open",
  "rel",
  "role",
  "rowspan",
  "scope",
  "src",
  "start",
  "style",
  "tabindex",
  "target",
  "title",
  "type",
  "width",
  "checked",
]);

export const ReaderNodeAttribute = Schema.Struct({
  name: ReaderAttributeName,
  value: Schema.String,
});

export type ReaderNodeValue = Data.TaggedEnum<{
  Element: {
    readonly attributes: readonly (typeof ReaderNodeAttribute.Type)[];
    readonly children: readonly ReaderNodeValue[];
    readonly tag: typeof ReaderTag.Type;
  };
  Text: { readonly value: string };
}>;

export const ReaderNode = Data.taggedEnum<ReaderNodeValue>();

export const ReaderNodeSchema: Schema.Codec<ReaderNodeValue> = Schema.suspend(
  () =>
    Schema.Union([
      Schema.TaggedStruct("Text", { value: Schema.String }),
      Schema.TaggedStruct("Element", {
        attributes: Schema.Array(ReaderNodeAttribute),
        children: Schema.Array(ReaderNodeSchema),
        tag: ReaderTag,
      }),
    ])
);

export const ReaderBreadcrumb = Schema.Struct({
  href: Schema.String,
  label: Schema.String,
  name: Schema.String,
});
