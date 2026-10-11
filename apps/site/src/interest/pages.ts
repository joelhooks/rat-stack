import { HttpServerResponse } from "effect/http";

import {
  interestConfirmDocumentHtml,
  interestResultDocumentHtml,
} from "../bundled-content.generated.js";
import { renderErrorPage } from "../error-page.js";
import { renderStaticDocument } from "../html.js";
import { contentSecurityPolicy } from "../security.js";

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

const pageHeaders = {
  "cache-control": "no-store",
  "content-security-policy": contentSecurityPolicy("'self'"),
  "x-robots-tag": "noindex",
} as const;

const page = (body: string, status: number) =>
  HttpServerResponse.text(body, {
    contentType: "text/html; charset=utf-8",
    headers: pageHeaders,
    status,
  });

export const resultPage = (
  origin: string,
  result: {
    readonly heading: string;
    readonly link?: { readonly href: string; readonly label: string };
    readonly message: string;
    readonly path?: string;
    readonly status: number;
  }
) => {
  const { link } = result;

  if (result.status >= 400) {
    return page(
      renderErrorPage(
        {
          code: result.status,
          matches:
            link === undefined
              ? []
              : [{ description: "", routePath: link.href, title: link.label }],
          message: result.message,
          path: result.path ?? "/tokenmaxx/confirm",
          title: result.heading,
        },
        origin,
        true
      ),
      result.status
    );
  }

  const linkHtml =
    link === undefined
      ? ""
      : `<p><a href="${escapeHtml(link.href)}">${escapeHtml(link.label)}</a></p>`;

  return page(
    renderStaticDocument(origin, interestResultDocumentHtml)
      .replaceAll("__INTEREST_HEADING__", escapeHtml(result.heading))
      .replaceAll("__INTEREST_MESSAGE__", escapeHtml(result.message))
      .replaceAll("__INTEREST_LINK__", linkHtml),
    result.status
  );
};

export const confirmPage = (origin: string, token: string) =>
  page(
    renderStaticDocument(origin, interestConfirmDocumentHtml).replaceAll(
      "__INTEREST_TOKEN__",
      escapeHtml(token)
    ),
    200
  );
