import {
  JOIN_RETENTION_DEFAULT_LIMIT,
  JoinRetentionBackfill,
  JoinRetentionBackfillUnavailable,
  JoinRetentionCountsSchema,
  JoinRetentionDiagnosticSchema,
  JoinRetentionFailureResponseSchema,
  joinRetentionBackfillContract,
} from "@rat-stack/core/join-interest";
import { Cause, Effect, Layer, Logger, Option, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const unavailable = () =>
  new JoinRetentionBackfillUnavailable({
    reason:
      "Retention backfill page failed. Fix: verify the origin, operator token and endpoint, then rerun a preview.",
  });

export const retentionBackfillFailure = <E>(
  cause: Cause.Cause<E>,
  fallback = unavailable()
) => {
  const error = Cause.findErrorOption(cause);

  return Option.isSome(error) &&
    Schema.is(JoinRetentionBackfillUnavailable)(error.value)
    ? error.value
    : fallback;
};

const RouteErrorText = Schema.Literals([
  "Applications unavailable.",
  "Bad request.",
  "Unauthorized.",
]);

const operatorUrl = Effect.fnUntraced(function* operatorUrl(
  origin: string,
  previewOverride: boolean
) {
  const url = yield* Effect.try({
    try: () => new URL(origin),
    catch: unavailable,
  });

  if (
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    (url.origin !== "https://ratstack.sh" && !previewOverride) ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      ))
  ) {
    return yield* unavailable();
  }

  return new URL("/operator/interest/applications/retention-backfill", url);
});

const requestPage = Effect.fnUntraced(function* requestPage(
  url: URL,
  token: Redacted.Redacted,
  http: HttpClient.HttpClient,
  dryRun: boolean,
  after: string | undefined,
  limit: number
) {
  const base = { apply: !dryRun, limit };

  const payload = yield* Schema.encodeEffect(
    joinRetentionBackfillContract.input
  )(after === undefined ? base : { ...base, after });

  const request = yield* HttpClientRequest.post(url).pipe(
    HttpClientRequest.bearerToken(token),
    HttpClientRequest.bodyJson(payload)
  );

  const response = yield* http.execute(request);

  if (response.status !== 200) {
    const body = yield* response.text.pipe(
      Effect.catchCause(() => Effect.succeed(""))
    );

    const diagnostic =
      response.status === 503 && !body.includes(Redacted.value(token))
        ? Schema.decodeOption(
            Schema.fromJsonString(JoinRetentionFailureResponseSchema)
          )(body).pipe(
            Option.flatMap(
              Schema.decodeUnknownOption(JoinRetentionDiagnosticSchema)
            )
          )
        : Option.none();

    const text = Option.getOrElse(
      Schema.decodeUnknownOption(RouteErrorText)(body.trim()),
      () => "Unrecognized response body (not displayed)."
    );

    const reason = `Retention backfill HTTP ${response.status}: ${Option.isSome(diagnostic) ? `Applications unavailable. ${JSON.stringify(diagnostic.value)}` : text} Fix: verify the operator endpoint and rerun a preview.`;

    return yield* new JoinRetentionBackfillUnavailable(
      Option.match(diagnostic, {
        onNone: () => ({ reason }),
        onSome: (fields) => ({ reason, diagnostic: fields }),
      })
    );
  }

  return yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(JoinRetentionCountsSchema))
  );
});

export const remoteJoinRetentionBackfillLayer = (
  origin: string,
  token: Redacted.Redacted,
  options: { readonly previewOriginOverride?: boolean } = {}
) =>
  Layer.effect(
    JoinRetentionBackfill,
    Effect.gen(function* makeRemoteBackfill() {
      if (Redacted.value(token).trim() === "") {
        return yield* unavailable();
      }

      const url = yield* operatorUrl(
        origin,
        options.previewOriginOverride === true
      );

      const http = yield* HttpClient.HttpClient;

      return {
        run: (
          dryRun: boolean,
          after?: string,
          limit = JOIN_RETENTION_DEFAULT_LIMIT
        ) =>
          !dryRun &&
          (url.origin !== "https://ratstack.sh" ||
            options.previewOriginOverride === true)
            ? Effect.fail(unavailable())
            : requestPage(url, token, http, dryRun, after, limit).pipe(
                Effect.timeout("30 seconds"),
                Effect.withTracerEnabled(false),
                Effect.provideService(FetchHttpClient.RequestInit, {
                  cache: "no-store",
                  redirect: "error",
                }),
                Effect.provide(Logger.layer([])),
                Effect.catchCause((cause) =>
                  Effect.fail(retentionBackfillFailure(cause))
                )
              ),
      };
    })
  );
