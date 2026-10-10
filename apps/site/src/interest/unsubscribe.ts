import { Effect, Layer, Option } from "effect";
import {
  FetchHttpClient,
  HttpClient,
  HttpClientRequest,
  HttpMiddleware,
  HttpRouter,
  HttpServerResponse,
} from "effect/http";
import type { HttpServerRequest } from "effect/http";

import { unsubscribeDocumentHtml } from "../bundled-content.generated.js";
import { renderStaticDocument } from "../html.js";
import { contentSecurityPolicy } from "../security.js";
import {
  UNSUBSCRIBE_HEADING,
  UNSUBSCRIBE_QUESTION,
  UNSUBSCRIBE_REFUSED,
  UNSUBSCRIBE_SUCCESS,
} from "./unsubscribe-copy.js";

export const UNSUBSCRIBE_PATH = "/tokenmaxx/unsubscribe";

const rawTokenSegment = (url: string) => {
  const index = url.indexOf("?");

  return index === -1
    ? undefined
    : url
        .slice(index + 1)
        .split("#")[0]
        ?.split("&")
        .find((segment) => segment.startsWith("t="));
};

const escapeAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const wantsHtml = (request: HttpServerRequest.HttpServerRequest) =>
  (request.headers.accept ?? "")
    .split(",")
    .some((entry) => entry.trim().split(";")[0] === "text/html");

interface UnsubscribeHeaders {
  readonly "cache-control": "no-store";
  "content-type"?: string;
  location?: string;
}

const page = (
  request: HttpServerRequest.HttpServerRequest,
  message: string,
  status: number,
  action?: string
) => {
  const form =
    action === undefined
      ? ""
      : `<form method="post" action="${escapeAttribute(action)}"><input type="hidden" name="List-Unsubscribe" value="One-Click" /><p><button type="submit">${UNSUBSCRIBE_HEADING}</button></p></form>`;

  return HttpServerResponse.text(
    renderStaticDocument(
      new URL(request.url, "https://ratstack.sh").origin,
      unsubscribeDocumentHtml
    )
      .replaceAll("__UNSUBSCRIBE_MESSAGE__", escapeAttribute(message))
      .replaceAll("__UNSUBSCRIBE_FORM__", form),
    {
      contentType: "text/html; charset=utf-8",
      headers: {
        "cache-control": "no-store",
        "content-security-policy": contentSecurityPolicy("'self'"),
        "x-robots-tag": "noindex",
      },
      status,
    }
  );
};

const unavailable = () =>
  HttpServerResponse.jsonUnsafe(
    { title: "Unable to complete this request", type: "about:blank" },
    {
      contentType: "application/problem+json",
      headers: { "cache-control": "no-store" },
      status: 502,
    }
  );

export const forwardUnsubscribe = Effect.fnUntraced(
  function* forwardUnsubscribe(
    client: HttpClient.HttpClient,
    request: HttpServerRequest.HttpServerRequest
  ) {
    const segment = rawTokenSegment(request.url);
    const destination = `https://api.drovr.sh/unsubscribe${segment === undefined ? "" : `?${segment}`}`;
    const contentType = request.headers["content-type"];
    const bytes = new Uint8Array(yield* request.arrayBuffer);

    const outgoing = HttpClientRequest.post(destination).pipe(
      HttpClientRequest.bodyUint8Array(bytes, contentType),
      contentType === undefined
        ? HttpClientRequest.removeHeader("content-type")
        : HttpClientRequest.setHeader("content-type", contentType)
    );

    const response = yield* client.execute(outgoing);
    const body = new Uint8Array(yield* response.arrayBuffer);

    const headers: UnsubscribeHeaders = { "cache-control": "no-store" };

    for (const key of ["content-type", "location"] as const) {
      const value = response.headers[key];

      if (value !== undefined) {
        headers[key] = value;
      }
    }

    return wantsHtml(request)
      ? page(
          request,
          response.status >= 200 && response.status < 300
            ? UNSUBSCRIBE_SUCCESS
            : UNSUBSCRIBE_REFUSED,
          response.status
        )
      : HttpServerResponse.raw(body, {
          headers: { ...headers },
          status: response.status,
        });
  },
  Effect.provideService(FetchHttpClient.RequestInit, {
    cache: "no-store",
    credentials: "omit",
    redirect: "manual",
  }),
  Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
  Effect.timeout("10 seconds"),
  Effect.catchCause(() => Effect.succeed(unavailable()))
);

export const unsubscribeRoutes = Layer.unwrap(
  Effect.gen(function* buildUnsubscribeRoutes() {
    const provided = yield* Effect.serviceOption(HttpClient.HttpClient);

    const client = Option.isSome(provided)
      ? provided.value
      : yield* HttpClient.HttpClient.pipe(
          Effect.provide(FetchHttpClient.layer)
        );

    return Layer.mergeAll(
      HttpRouter.add("GET", UNSUBSCRIBE_PATH, (request) => {
        const segment = rawTokenSegment(request.url);

        return Effect.succeed(
          segment === undefined || segment === "t="
            ? page(request, UNSUBSCRIBE_REFUSED, 400)
            : page(
                request,
                UNSUBSCRIBE_QUESTION,
                200,
                `${UNSUBSCRIBE_PATH}?${segment}`
              )
        ).pipe(HttpMiddleware.withLoggerDisabled);
      }),
      HttpRouter.add("POST", UNSUBSCRIBE_PATH, (request) =>
        forwardUnsubscribe(client, request).pipe(
          HttpMiddleware.withLoggerDisabled
        )
      )
    );
  })
);
