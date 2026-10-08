import { Context, Effect, Schema } from "effect";
import * as HttpServerResponse from "effect/http/HttpServerResponse";

import { renderErrorPage } from "./error-page.js";
import type { ErrorPage } from "./error-page.js";
import { ReaderErrorPage, readerErrorPath } from "./reader-error-page.js";
import { readerContentSecurityPolicy } from "./security.js";
import type { AssetBinding } from "./static-assets.js";

export class WebsiteErrorPageError extends Schema.TaggedError<WebsiteErrorPageError>()(
  "WebsiteErrorPageError",
  { cause: Schema.Defect(), message: Schema.String }
) {}

export interface ErrorPageRendererService {
  readonly html: (
    page: ErrorPage,
    origin: string
  ) => Effect.Effect<HttpServerResponse.HttpServerResponse>;
}

const htmlPage = (body: string, status: number, headers?: Headers) =>
  HttpServerResponse.text(body, {
    contentType: "text/html; charset=utf-8",
    headers,
    status,
  });

export const mischiefErrorPage = (page: ErrorPage, origin: string) =>
  htmlPage(renderErrorPage(page, origin, true), page.code);

export const ErrorPageRenderer = Context.Reference<ErrorPageRendererService>(
  "@rat-stack/mischief/ErrorPageRenderer",
  {
    defaultValue: () => ({
      html: (page, origin) => Effect.succeed(mischiefErrorPage(page, origin)),
    }),
  }
);

const encodePage = Schema.encodeEffect(Schema.fromJsonString(ReaderErrorPage));

const websiteErrorPage = Effect.fn("websiteErrorPage")(
  function* websiteErrorPage<E>(
    website: Effect.Effect<AssetBinding, E>,
    page: ErrorPage,
    origin: string
  ) {
    const binding = yield* website.pipe(
      Effect.mapError(
        (cause) =>
          new WebsiteErrorPageError({
            cause,
            message: "The WEBSITE binding is unavailable",
          })
      )
    );

    const body = yield* encodePage(page).pipe(
      Effect.mapError(
        (cause) =>
          new WebsiteErrorPageError({
            cause,
            message: "The error page does not match ReaderErrorPage",
          })
      )
    );

    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new WebsiteErrorPageError({
          cause,
          message: "The WEBSITE binding did not answer the error page request",
        }),
      try: binding.fetch.bind(
        binding,
        new Request(new URL(readerErrorPath, origin), {
          body,
          headers: {
            accept: "text/html",
            "content-type": "application/json",
          },
          method: "POST",
        })
      ),
    });

    const contentType = response.headers.get("content-type") ?? "";

    if (response.status !== page.code || !contentType.startsWith("text/html")) {
      if (response.body !== null) {
        yield* Effect.tryPromise(response.body.cancel.bind(response.body)).pipe(
          Effect.ignore
        );
      }

      return yield* new WebsiteErrorPageError({
        cause: undefined,
        message: `Website answered ${response.status} ${contentType} for a ${page.code} error page`,
      });
    }

    const html = yield* Effect.tryPromise({
      catch: (cause) =>
        new WebsiteErrorPageError({
          cause,
          message: "The Website error page body could not be read",
        }),
      try: response.text.bind(response),
    });

    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    headers.delete("content-type");
    headers.set("content-security-policy", readerContentSecurityPolicy);

    return htmlPage(html, page.code, headers);
  }
);

export const websiteErrorPages = <E>(
  website: Effect.Effect<AssetBinding, E>
): ErrorPageRendererService => ({
  html: (page, origin) =>
    websiteErrorPage(website, page, origin).pipe(
      Effect.catchTag("WebsiteErrorPageError", (failure) =>
        Effect.logWarning(
          "Website error page fell back to Mischief",
          failure
        ).pipe(Effect.as(mischiefErrorPage(page, origin)))
      )
    ),
});
