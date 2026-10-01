import { errorPageTemplates } from "./bundled-content.generated.js";
import { renderStaticDocument } from "./html.js";

export interface ErrorPage {
  readonly code: number;
  readonly title: string;
  readonly message: string;
  readonly path: string;
  readonly details?: { readonly html: string; readonly markdown: string };
  readonly matches?: readonly {
    readonly title: string;
    readonly routePath: string;
    readonly description: string;
  }[];
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const escapeMarkdown = (value: string) =>
  value
    .replaceAll("\\", "\\\\")
    .replaceAll("`", "\\`")
    .replaceAll("[", "\\[")
    .replaceAll("]", "\\]")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const fill = (template: string, values: Readonly<Record<string, string>>) =>
  template.replaceAll(/ERROR_[A-Z_]+/gu, (token) => values[token] ?? token);

export const renderErrorPage = (
  page: ErrorPage,
  origin: string,
  html: boolean
) => {
  const escape = html ? escapeHtml : escapeMarkdown;
  const matches = page.matches ?? [];

  const suggestions = matches
    .map((match) =>
      fill(
        html
          ? errorPageTemplates.suggestionHtml
              .replaceAll("<ol>", "")
              .replaceAll("</ol>", "")
          : errorPageTemplates.suggestionMarkdown,
        {
          ERROR_LINK_DESCRIPTION: escape(match.description),
          ERROR_LINK_PATH: escape(match.routePath),
          ERROR_LINK_TITLE: escape(match.title),
        }
      )
    )
    .join("\n");

  const nextActions = html
    ? errorPageTemplates.actionsHtml
    : errorPageTemplates.actionsMarkdown;

  const matchActions = html ? `<ol>${suggestions}</ol>` : suggestions;
  const actions = matches.length === 0 ? nextActions : matchActions;

  const template = html
    ? renderStaticDocument(origin, errorPageTemplates.documentHtml)
        .replaceAll("<p>ERROR_ACTIONS</p>", "ERROR_ACTIONS")
        .replaceAll("<p>ERROR_DETAILS</p>", "ERROR_DETAILS")
    : errorPageTemplates.markdown;

  return fill(template, {
    ERROR_ACTIONS: actions,
    ERROR_CODE: String(page.code),
    ERROR_DETAILS: (html ? page.details?.html : page.details?.markdown) ?? "",
    ERROR_MESSAGE: escape(page.message),
    ERROR_PATH: escape(page.path),
    ERROR_TITLE: escape(page.title),
  });
};
