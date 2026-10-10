import { Match, Option } from "effect";

import type { ReaderErrorPage } from "../../../mischief/src/reader-error-page.js";
import { ReaderNode } from "../client/reader-node.js";
import type { ReaderNodeValue } from "../client/reader-node.js";
import type { ReaderPageFlags } from "../client/reader/model.js";
import type { ReaderErrorTemplate } from "./reader-error-template.js";

type Tokens = Readonly<Record<string, string>>;

const fill = (value: string, tokens: Tokens) =>
  value.replaceAll(/ERROR_[A-Z_]+/gu, (token) => tokens[token] ?? token);

const fillNode = (node: ReaderNodeValue, tokens: Tokens): ReaderNodeValue =>
  ReaderNode.$match(node, {
    CopyPrompt: () => node,
    Element: ({ attributes, children, tag }) =>
      ReaderNode.Element({
        attributes: attributes.map(({ name, value }) => ({
          name,
          value: fill(value, tokens),
        })),
        children: children.map((child) => fillNode(child, tokens)),
        tag,
      }),
    Text: ({ value }) => ReaderNode.Text({ value: fill(value, tokens) }),
  });

const placeholder = (node: ReaderNodeValue): string | undefined => {
  if (!ReaderNode.$is("Element")(node) || node.tag !== "p") {
    return undefined;
  }

  const [only, ...rest] = node.children;

  return rest.length === 0 &&
    only !== undefined &&
    ReaderNode.$is("Text")(only) &&
    /^ERROR_(?:ACTIONS|DETAILS)$/u.test(only.value)
    ? only.value
    : undefined;
};

const suggestionItems = (
  template: typeof ReaderErrorTemplate.Type,
  page: typeof ReaderErrorPage.Type
): readonly ReaderNodeValue[] =>
  (page.matches ?? []).flatMap((match, index) => [
    ...(index === 0 ? [] : [ReaderNode.Text({ value: "\n" })]),
    ...template.suggestion
      .flatMap((node) =>
        ReaderNode.$is("Element")(node) && node.tag === "ol"
          ? node.children
          : [node]
      )
      .map((node) =>
        fillNode(node, {
          ERROR_LINK_DESCRIPTION: match.description,
          ERROR_LINK_PATH: match.routePath,
          ERROR_LINK_TITLE: match.title,
        })
      ),
  ]);

const actions = (
  template: typeof ReaderErrorTemplate.Type,
  page: typeof ReaderErrorPage.Type
): readonly ReaderNodeValue[] =>
  (page.matches ?? []).length === 0
    ? template.actions
    : [
        ReaderNode.Element({
          attributes: [],
          children: suggestionItems(template, page),
          tag: "ol",
        }),
      ];

const details = (
  template: typeof ReaderErrorTemplate.Type,
  page: typeof ReaderErrorPage.Type
): readonly ReaderNodeValue[] =>
  page.details === undefined
    ? []
    : Match.valueTags(page.details, {
        Incident: ({ id }) => [
          ReaderNode.Element({
            attributes: [],
            children: [ReaderNode.Text({ value: `Incident id: ${id}` })],
            tag: "p",
          }),
        ],
        NoVerify: () => template.noVerifyDetails,
      });

const pageTokens = (page: typeof ReaderErrorPage.Type) =>
  ({
    ERROR_CODE: String(page.code),
    ERROR_MESSAGE: page.message,
    ERROR_PATH: page.path,
    ERROR_TITLE: page.title,
  }) satisfies Tokens;

export const readerErrorFlags = (
  template: typeof ReaderErrorTemplate.Type,
  page: typeof ReaderErrorPage.Type
): ReaderPageFlags => {
  const tokens = pageTokens(page);

  const bodyNodes = Option.getOrElse(template.page.bodyNodes, () => []).flatMap(
    (node) => {
      const slot = placeholder(node);

      if (slot === "ERROR_ACTIONS") {
        return actions(template, page);
      }

      if (slot === "ERROR_DETAILS") {
        return details(template, page);
      }

      return [fillNode(node, tokens)];
    }
  );

  return {
    ...template.page,
    bodyNodes: Option.some(bodyNodes),
    heading: fill(template.page.heading, tokens),
    page: {
      ...template.page.page,
      metadata: {
        ...template.page.page.metadata,
        description: fill(template.page.page.metadata.description, tokens),
        title: fill(template.page.page.metadata.title, tokens),
      },
      status: page.code,
    },
  };
};
