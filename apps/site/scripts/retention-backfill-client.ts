import {
  JOIN_RETENTION_DEFAULT_LIMIT,
  JoinRetentionBackfill,
  JoinRetentionBackfillUnavailable,
  JoinRetentionCountsSchema,
  joinRetentionBackfillContract,
} from "@rat-stack/core/join-interest";
import { Effect, Layer, Logger, Redacted, Schema } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

const unavailable = () =>
  new JoinRetentionBackfillUnavailable({
    reason:
      "Retention backfill page failed. Fix: verify the origin, operator token and endpoint, then rerun a preview.",
  });

const operatorUrl = Effect.fnUntraced(function* operatorUrl(origin: string) {
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
    return yield* unavailable();
  }

  return yield* response.json.pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(JoinRetentionCountsSchema))
  );
});

export const remoteJoinRetentionBackfillLayer = (
  origin: string,
  token: Redacted.Redacted
) =>
  Layer.effect(
    JoinRetentionBackfill,
    Effect.gen(function* makeRemoteBackfill() {
      if (Redacted.value(token).trim() === "") {
        return yield* unavailable();
      }

      const url = yield* operatorUrl(origin);
      const http = yield* HttpClient.HttpClient;

      return {
        run: (
          dryRun: boolean,
          after?: string,
          limit = JOIN_RETENTION_DEFAULT_LIMIT
        ) =>
          requestPage(url, token, http, dryRun, after, limit).pipe(
            Effect.timeout("30 seconds"),
            Effect.withTracerEnabled(false),
            Effect.provideService(FetchHttpClient.RequestInit, {
              cache: "no-store",
              redirect: "error",
            }),
            Effect.provide(Logger.layer([])),
            Effect.catchCause(() => Effect.fail(unavailable()))
          ),
      };
    })
  );
