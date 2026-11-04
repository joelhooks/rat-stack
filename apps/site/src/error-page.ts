import { Effect, Match } from "effect";

import type { errorPageTemplates as ErrorPageTemplates } from "./error-page-templates.generated.js";
import { renderStaticDocument } from "./html.js";
import type { ReaderErrorPage } from "./reader-error-page.js";

export type ErrorPage = typeof ReaderErrorPage.Type;

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

type Templates = typeof ErrorPageTemplates;

const loadTemplates = Effect.promise(
  () => import("./error-page-templates.generated.js")
);

const errorDetails = (
  errorPageTemplates: Templates,
  page: ErrorPage,
  html: boolean
) =>
  page.details === undefined
    ? ""
    : Match.valueTags(page.details, {
        Incident: ({ id }) =>
          html ? `<p>Incident id: ${id}</p>` : `Incident id: ${id}`,
        NoVerify: () =>
          html
            ? errorPageTemplates.noVerifyDetails.html
            : errorPageTemplates.noVerifyDetails.markdown,
      });

const renderWithTemplates = (
  errorPageTemplates: Templates,
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
    ERROR_DETAILS: errorDetails(errorPageTemplates, page, html),
    ERROR_MESSAGE: escape(page.message),
    ERROR_PATH: escape(page.path),
    ERROR_TITLE: escape(page.title),
  });
};

export const renderErrorPage = (
  page: ErrorPage,
  origin: string,
  html: boolean
) =>
  loadTemplates.pipe(
    Effect.map(({ errorPageTemplates }) =>
      renderWithTemplates(errorPageTemplates, page, origin, html)
    )
  );
