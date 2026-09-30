import { HttpServerResponse } from "effect/unstable/http";

import {
  interestConfirmDocumentHtml,
  interestResultDocumentHtml,
} from "../bundled-content.generated.js";
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
    readonly message: string;
    readonly status: number;
  }
) =>
  page(
    renderStaticDocument(origin, interestResultDocumentHtml)
      .replaceAll("__INTEREST_HEADING__", escapeHtml(result.heading))
      .replaceAll("__INTEREST_MESSAGE__", escapeHtml(result.message)),
    result.status
  );

export const confirmPage = (origin: string, token: string) =>
  page(
    renderStaticDocument(origin, interestConfirmDocumentHtml).replaceAll(
      "__INTEREST_TOKEN__",
      escapeHtml(token)
    ),
    200
  );
