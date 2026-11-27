import { Effect, Option } from "effect";

import { compileReaderSnippet } from "../../site/scripts/reader-body-document.js";
import { ReaderInputError } from "../../site/scripts/reader-input-error.js";
import { ReaderBlock, ReaderInline } from "../src/client/reader-document.js";
import type { ReaderInlineValue } from "../src/client/reader-document.js";
import { ReaderNode } from "../src/client/reader-node.js";
import type { ReaderNodeValue } from "../src/client/reader-node.js";
import type { ReaderPageFlags } from "../src/client/reader/model.js";
import { readerParagraphAnchor } from "../src/features/reader-paragraph.js";

type Element = ReturnType<typeof ReaderNode.Element>;

const headingTags = { 2: "h2", 3: "h3", 4: "h4" } as const;

const text = (value: string) => ReaderNode.Text({ value });

const element = (
  tag: Element["tag"],
  children: readonly ReaderNodeValue[],
  attributes: Element["attributes"] = []
) => ReaderNode.Element({ attributes, children, tag });

const attributed = (
  tag: Element["tag"],
  name: Element["attributes"][number]["name"],
  value: string,
  children: readonly ReaderNodeValue[]
) => element(tag, children, [{ name, value }]);

const link = (href: string, label: string) =>
  attributed("a", "href", href, [text(label)]);

const renderInline = (
  inline: ReaderInlineValue,
  counts: Readonly<Record<string, number>>,
  pagePath: string
): ReaderNodeValue =>
  ReaderInline.$match(inline, {
    Code: ({ value }) => element("code", [text(value)]),
    Emphasis: ({ content }) =>
      element(
        "em",
        content.map((child) => renderInline(child, counts, pagePath))
      ),
    Link: ({ href, value }) => {
      const anchor = link(href, value);
      const count = counts[href] ?? 0;

      if (
        href === pagePath ||
        !/^\/(?:lore|systems|skills)\//u.test(href) ||
        count < 2
      ) {
        return anchor;
      }

      return element("span", [
        anchor,
        attributed("sup", "class", "inbound-count", [
          element(
            "a",
            [text(String(count))],
            [
              { name: "href", value: `${href}#linked-from` },
              { name: "aria-label", value: `${count} pages link here` },
            ]
          ),
        ]),
      ]);
    },
    Strong: ({ content }) =>
      element(
        "strong",
        content.map((child) => renderInline(child, counts, pagePath))
      ),
    Text: ({ value }) =>
      text(value.replaceAll(/(?<=\p{L})\u0027(?=\p{L})/gu, "’")),
  });

const missingSnippet = (message: string) =>
  element(
    "p",
    [text(message)],
    [
      { name: "class", value: "reader-missing" },
      { name: "role", value: "note" },
    ]
  );

const legacyNodes = (flags: ReaderPageFlags) => {
  const { anchors = [], inboundCounts = {} } =
    Option.getOrUndefined(flags.references) ?? {};

  const { path, sourcePath } = flags.page;

  const paragraph = (
    tag: "li" | "p",
    content: readonly ReaderInlineValue[]
  ) => {
    const id = readerParagraphAnchor(tag, content, anchors);

    const children = content.map((inline) =>
      renderInline(inline, inboundCounts, path)
    );

    return id === undefined
      ? element(tag, children)
      : attributed(tag, "id", id, [
          ...children,
          element(
            "a",
            [text("¶")],
            [
              { name: "href", value: `#${id}` },
              { name: "class", value: "paragraph-link" },
              { name: "aria-label", value: "Link to this paragraph" },
            ]
          ),
        ]);
  };

  const snippet = (html: string) =>
    attributed(
      "div",
      "class",
      "reader-snippet",
      compileReaderSnippet(html, sourcePath)
    );

  const codeFence = (value: string) => {
    const fence = flags.codeFences.find((entry) => entry.value === value);

    return fence === undefined
      ? missingSnippet("This code block is not in the built page.")
      : snippet(fence.html);
  };

  return flags.blocks.map((block) =>
    ReaderBlock.match<ReaderNodeValue>(block, {
      CodeFence: ({ value }) => codeFence(value),
      CopyPrompt: ({ id }) => {
        const control = ReaderNode.CopyPrompt({ id, primary: false });
        const prompt = flags.copyPrompts.find((entry) => entry.id === id);

        return prompt?.showText === true
          ? attributed("div", "class", "prompt", [
              control,
              attributed("details", "class", "prompt-text", [
                element("summary", [text("See the prompt")]),
                element("pre", [element("code", [text(prompt.text)])]),
              ]),
            ])
          : control;
      },
      Diagram: ({ alt, value }) =>
        element(
          "figure",
          [codeFence(value), element("figcaption", [text(alt)])],
          [
            { name: "role", value: "img" },
            { name: "aria-label", value: alt },
          ]
        ),
      Heading: ({ id, level, title }) =>
        attributed(headingTags[level ?? 2], "id", id, [text(title)]),
      List: ({ items }) =>
        element(
          "ul",
          items.map((item) => paragraph("li", item))
        ),
      Paragraph: ({ content }) => paragraph("p", content),
      PromptText: ({ value }) =>
        attributed("pre", "class", "prompt", [text(value)]),
      Snippet: (reference) => {
        const excerpt = flags.snippets.find(
          (entry) =>
            entry.repo === reference.repo &&
            entry.path === reference.path &&
            entry.at === reference.at &&
            entry.lines === reference.lines
        );

        return excerpt === undefined
          ? missingSnippet(
              `The excerpt ${reference.path} lines ${reference.lines} is not in the built page.`
            )
          : snippet(excerpt.html);
      },
    })
  );
};

export const compileLegacyReaderPage = Effect.fn("reader.compileLegacyPage")(
  function* compileLegacyReaderPage(flags: ReaderPageFlags) {
    const { path, sourcePath } = flags.page;

    const blocks = yield* Effect.try({
      catch: (cause) =>
        new ReaderInputError({
          cause,
          message: `Could not project the reader blocks for ${path}. Fix: check the excerpt tags and attributes in \`reader-body-document.ts\`.`,
          sourcePath,
        }),
      try: () => legacyNodes(flags),
    });

    const body = Option.getOrElse(flags.bodyNodes, () => [
      element("h1", [text(flags.heading)]),
    ]);

    return {
      ...flags,
      blocks: [],
      bodyNodes: Option.some([...body, ...blocks]),
    };
  }
);
