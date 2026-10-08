import * as HttpServerResponse from "effect/http/HttpServerResponse";

const policy = (sources: {
  readonly base: string;
  readonly formAction: string;
  readonly scripts: string;
  readonly styles: string;
}) =>
  `default-src 'none'; style-src ${sources.styles}; img-src 'self' data:; script-src ${sources.scripts}; connect-src 'self' https://cloudflareinsights.com; base-uri ${sources.base}; form-action ${sources.formAction}; frame-ancestors 'none'`;

export const contentSecurityPolicy = (formAction: "'none'" | "'self'") =>
  policy({
    base: "'none'",
    formAction,
    scripts: "https://static.cloudflareinsights.com",
    styles: "'unsafe-inline'",
  });

export const readerContentSecurityPolicy = policy({
  base: "'self'",
  formAction: "'none'",
  scripts: "'self' https://static.cloudflareinsights.com",
  styles: "'self' 'unsafe-inline'",
});

export const securityHeaders = {
  "cross-origin-opener-policy": "same-origin",
  "cross-origin-resource-policy": "same-origin",
  "permissions-policy": "camera=(), microphone=(), geolocation=()",
  "referrer-policy": "strict-origin-when-cross-origin",
  "strict-transport-security": "max-age=31536000; includeSubDomains",
  "x-content-type-options": "nosniff",
  "x-fence": "electrified",
  "x-frame-options": "DENY",
};

export const htmlRevalidateEveryVisit = "no-cache";

export const secureResponse = (
  response: HttpServerResponse.HttpServerResponse,
  htmlPolicy: string
) => {
  const contentType = response.headers["content-type"] ?? "";

  const secured = HttpServerResponse.setHeaders(response, securityHeaders).pipe(
    HttpServerResponse.setHeaders(
      response.status >= 500
        ? { "cache-control": "no-store" }
        : response.headers
    )
  );

  const embeddable = contentType.startsWith("image/")
    ? HttpServerResponse.setHeader(
        secured,
        "cross-origin-resource-policy",
        "cross-origin"
      )
    : secured;

  return contentType.startsWith("text/html")
    ? HttpServerResponse.setHeaders(embeddable, {
        "cache-control":
          response.status >= 500
            ? "no-store"
            : (response.headers["cache-control"] ?? htmlRevalidateEveryVisit),
        "content-security-policy":
          response.headers["content-security-policy"] ?? htmlPolicy,
      })
    : embeddable;
};
